import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, toPaise, voidEntry } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { financialYearOf, addMonths } from '../../src/core/loans';
import { COMPARE_MONTHS, POINTS_WARNING_DAYS, pointsState, pointsValue, rewardRate, type PointsMove } from '../../src/core/rewards';
import { categoryByKey } from './categories';
import { lockedMoneyAccount } from './entries';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Card rewards (v2 Phase 4, src/core/rewards.ts, migration 0034): reward points earned, redeemed
 * and expired on each card, cashback, and how each card compares. Cashback and points redeemed for
 * money are income in "Cashback and rewards" on the account the money went to (the card itself or a
 * bank); cashback already entered on a card in that category counts too. Points are not money: their
 * value (at the card's value per point, if set) is shown, never added to net worth.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;
type Kind = 'earned' | 'redeemed' | 'expired' | 'cashback';
const KINDS: Kind[] = ['earned', 'redeemed', 'expired', 'cashback'];

export interface CardRewards {
    /** The card's ledger account id */
    id: number;
    name: string;
    /** ₹ per point, if set */
    pointValue: string | null;
    points: { balance: number; value: string | null; expiring: { expiresOn: string; points: number; daysLeft: number }[]; lapsed: number };
    cashback: { thisYear: string; byYear: { year: string; amount: string }[] };
    /** The last 12 months: spent on the card, what it gave back (cashback, and points earned at their value), and the rate */
    compare: { spent: string; rewards: string; rate: number | null; pointsUnvalued: boolean };
    history: { id: number; kind: Kind; date: string; points: number; amount: string; expiresOn: string | null; note: string | null; into: string | null }[];
}

function pointsOf(value: unknown): number {
    const points = Number(value);
    if (!Number.isFinite(points) || points <= 0 || points > 1e9 || Math.round(points * 100) !== points * 100) throw new RequestError(400, t('errors.rewards.badPoints'));
    return points;
}

function paiseOf(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0;
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise < 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

function dateOf(value: unknown, field: string, allowFuture = false): string {
    if (!value) throw new RequestError(400, t('errors.fieldRequired', { field }));
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.fieldNotValidDate', { field }));
    if (!allowFuture && date.date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field }));
    return date.date;
}

// ----- Reading -----

async function loadRewards(client: Client, userId: number, onlyId?: number): Promise<CardRewards[]> {
    const cards = await client.query(
        `SELECT id, name, point_value::text AS point_value FROM ledger_accounts
         WHERE user_id = $1 AND subtype = 'credit_card' AND archived_at IS NULL AND ($2::bigint IS NULL OR id = $2) ORDER BY lower(name)`, [userId, onlyId ?? null]);
    if (cards.rows.length === 0) return [];
    const ids = cards.rows.map(row => row.id);
    const rows = (await client.query(
        `SELECT r.id, r.account_id, r.kind, r.on_date::text AS on_date, r.points::text AS points, r.amount_paise, r.expires_on::text AS expires_on, r.note, r.entry_id,
                (SELECT a.name FROM journal_lines l JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
                 WHERE l.user_id = r.user_id AND l.entry_id = r.entry_id AND l.amount_paise > 0 LIMIT 1) AS into_name
         FROM card_rewards r WHERE r.user_id = $1 AND r.account_id = ANY($2::bigint[]) AND r.deleted_at IS NULL ORDER BY r.on_date DESC, r.id DESC`,
        [userId, ids])).rows;
    // Cashback entered on the card itself (Transactions, an import), not through a reward record
    const direct = (await client.query(
        `SELECT m.account_id, e.entry_date::text AS entry_date, m.amount_paise
         FROM journal_entries e
         JOIN journal_lines m ON m.user_id = e.user_id AND m.entry_id = e.id AND m.account_id = ANY($2::bigint[]) AND m.amount_paise > 0
         JOIN journal_lines c ON c.user_id = e.user_id AND c.entry_id = e.id
         JOIN ledger_accounts ca ON ca.user_id = c.user_id AND ca.id = c.account_id AND ca.category_key = 'cashback'
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type = 'income'
           AND NOT EXISTS (SELECT 1 FROM card_rewards r WHERE r.user_id = e.user_id AND r.entry_id = e.id AND r.deleted_at IS NULL)`, [userId, ids])).rows;
    const today = todayInIndia();
    const from = addMonths(today, -COMPARE_MONTHS);
    // Spent on each card in the last 12 months: the card's side of its expense entries
    const spent = new Map((await client.query(
        `SELECT l.account_id, -SUM(l.amount_paise)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE l.user_id = $1 AND l.account_id = ANY($2::bigint[]) AND e.voided_at IS NULL AND e.entry_type IN ('expense', 'shared_expense')
           AND e.entry_date > $3::date AND l.amount_paise < 0 GROUP BY l.account_id`, [userId, ids, from])).rows.map(row => [String(row.account_id), Number(row.paise)]));
    const thisYear = financialYearOf(today);
    return cards.rows.map(card => {
        const mine = rows.filter(row => String(row.account_id) === String(card.id));
        const rate = card.point_value === null ? null : Number(card.point_value);
        const state = pointsState(mine.filter(row => row.kind !== 'cashback').map((row): PointsMove => ({
            kind: row.kind, date: row.on_date, points: Number(row.points), expiresOn: row.expires_on,
        })), today);
        const cashbacks = [
            ...mine.filter(row => row.kind === 'cashback').map(row => ({ date: row.on_date as string, paise: Number(row.amount_paise) })),
            ...direct.filter(row => String(row.account_id) === String(card.id)).map(row => ({ date: row.entry_date as string, paise: Number(row.amount_paise) })),
        ];
        const years = new Map<string, number>();
        for (const item of cashbacks) years.set(financialYearOf(item.date), (years.get(financialYearOf(item.date)) ?? 0) + item.paise);
        const recentCashback = cashbacks.filter(item => item.date > from).reduce((sum, item) => sum + item.paise, 0);
        const recentPoints = mine.filter(row => row.kind === 'earned' && row.on_date > from).reduce((sum, row) => sum + Number(row.points), 0);
        const rewards = recentCashback + (pointsValue(recentPoints, rate) ?? 0);
        const spentPaise = spent.get(String(card.id)) ?? 0;
        const value = pointsValue(state.balance, rate);
        return {
            id: Number(card.id), name: card.name, pointValue: card.point_value === null ? null : String(Number(card.point_value)),
            points: { balance: state.balance, value: value === null ? null : fromPaise(value), expiring: state.expiring.filter(item => item.daysLeft <= POINTS_WARNING_DAYS), lapsed: state.lapsed },
            cashback: {
                thisYear: fromPaise(years.get(thisYear) ?? 0),
                byYear: [...years].sort((a, b) => b[0].localeCompare(a[0])).map(([year, paise]) => ({ year, amount: fromPaise(paise) })),
            },
            compare: { spent: fromPaise(spentPaise), rewards: fromPaise(rewards), rate: rewardRate(rewards, spentPaise), pointsUnvalued: rate === null && recentPoints > 0 },
            history: mine.map(row => ({
                id: Number(row.id), kind: row.kind, date: row.on_date, points: Number(row.points), amount: fromPaise(Number(row.amount_paise)),
                expiresOn: row.expires_on, note: row.note, into: row.into_name,
            })),
        };
    });
}

export async function listRewards(pool: Pool, userId: number): Promise<CardRewards[]> {
    return loadRewards(pool, userId);
}

async function lockedCard(client: Client, userId: number, id: unknown): Promise<{ id: number; name: string }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.cards.notFound'));
    const found = await client.query("SELECT id, name FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND subtype = 'credit_card' AND archived_at IS NULL FOR UPDATE", [id, userId]);
    if (found.rows.length === 0) throw new RequestError(404, t('errors.cards.notFound'));
    return { id: Number(found.rows[0].id), name: found.rows[0].name };
}

// ----- Changes -----

/** { pointValue }: ₹ per reward point, or empty to clear it */
export async function setPointValue(pool: Pool, userId: number, id: string, body: Body): Promise<CardRewards> {
    let value: number | null = null;
    if (body.pointValue !== undefined && body.pointValue !== null && body.pointValue !== '') {
        value = Number(body.pointValue);
        if (!Number.isFinite(value) || value < 0 || value > 100) throw new RequestError(400, t('errors.rewards.badPointValue'));
    }
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        await client.query('UPDATE ledger_accounts SET point_value = $1 WHERE id = $2 AND user_id = $3', [value, card.id, userId]);
        await logActivity(client, userId, 'updated', 'card_reward', card.id, `Set the value of a point on ${card.name}`, null, null, { pointValue: value });
        return (await loadRewards(client, userId, card.id))[0]!;
    });
}

/**
 * { kind: earned | redeemed | expired | cashback, date, points?, amount?, expiresOn?, intoAccountId?, note? }.
 * Cashback (and points redeemed for money, with an amount) is income on intoAccountId, the card by default.
 */
export async function recordReward(pool: Pool, userId: number, id: string, body: Body): Promise<CardRewards> {
    const kind = String(body.kind) as Kind;
    if (!KINDS.includes(kind)) throw new RequestError(400, t('errors.rewards.badKind'));
    const date = dateOf(body.date, t('errors.people.dateField'));
    const points = kind === 'cashback' ? 0 : pointsOf(body.points);
    const amount = kind === 'expired' || kind === 'earned' ? 0 : paiseOf(body.amount);
    if (kind === 'cashback' && amount <= 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    const expiresOn = kind === 'earned' && body.expiresOn ? dateOf(body.expiresOn, t('errors.rewards.expiresField'), true) : null;
    if (expiresOn && expiresOn < date) throw new RequestError(400, t('errors.rewards.expiresEarly'));
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        let entryId: number | null = null;
        if (amount > 0) {
            const into = body.intoAccountId ? await lockedMoneyAccount(client, userId, body.intoAccountId) : { id: card.id, name: card.name };
            entryId = await postEntry(client, {
                userId, date, type: 'income', description: t(kind === 'cashback' ? 'rewards.entry.cashback' : 'rewards.entry.redeemed', { name: card.name }),
                lines: [{ accountId: into.id, paise: amount }, { accountId: await categoryByKey(client, userId, 'cashback', 'income'), paise: -amount }],
            });
        }
        await client.query(
            `INSERT INTO card_rewards (user_id, account_id, kind, on_date, points, amount_paise, expires_on, note, entry_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [userId, card.id, kind, date, points, amount, expiresOn, note, entryId]);
        await logActivity(client, userId, 'created', 'card_reward', card.id, `Recorded ${kind === 'cashback' ? 'cashback' : `${points} points ${kind}`} on ${card.name}`,
            amount > 0 ? fromPaise(amount) : null, null, { kind, date, points, amount: fromPaise(amount), expiresOn, note });
        return (await loadRewards(client, userId, card.id))[0]!;
    });
}

/** Remove a reward recorded by mistake; its income entry is voided */
export async function deleteReward(pool: Pool, userId: number, id: string, rewardId: string): Promise<CardRewards> {
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        const found = await client.query('SELECT id, kind, entry_id FROM card_rewards WHERE id = $1 AND account_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE',
            [/^\d+$/.test(rewardId) ? rewardId : 0, card.id, userId]);
        const row = found.rows[0];
        if (!row) throw new RequestError(404, t('errors.rewards.notFound'));
        if (row.entry_id !== null) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE card_rewards SET deleted_at = now() WHERE id = $1 AND user_id = $2', [row.id, userId]);
        await logActivity(client, userId, 'deleted', 'card_reward', card.id, `Removed a reward record of ${card.name}`, null, { reward: Number(row.id), kind: row.kind }, null);
        return (await loadRewards(client, userId, card.id))[0]!;
    });
}

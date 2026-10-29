import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';

/**
 * Credit lines (v2 Phase 4, migration 0032): one limit shared by several cards. Each card keeps its
 * own limit; the room left on a card is the smaller of what is left on its own limit and on the line
 * (lib/services/entries.ts, creditLineRoom in lib/ledger.ts). A card is on one line at most.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface CreditLine {
    id: number;
    name: string;
    limit: string;
    owed: string;
    available: string;
    cards: { id: number; name: string; owed: string }[];
}

function lineName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) throw new RequestError(400, t('errors.cards.lineNameRequired'));
    if (name.length > 80) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 80 }));
    return name;
}

function limitOf(value: unknown): number {
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise <= 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

function cardIdsOf(value: unknown): number[] {
    if (!Array.isArray(value)) throw new RequestError(400, t('errors.cards.lineNeedsTwo'));
    const ids = [...new Set(value.map(Number))];
    if (ids.some(id => !Number.isInteger(id) || id <= 0)) throw new RequestError(400, t('errors.cards.notFound'));
    if (ids.length < 2) throw new RequestError(400, t('errors.cards.lineNeedsTwo'));
    return ids;
}

async function loadLines(client: Client, userId: number, onlyId?: number): Promise<CreditLine[]> {
    const lines = await client.query(
        'SELECT id, name, limit_paise FROM credit_lines WHERE user_id = $1 AND deleted_at IS NULL AND ($2::bigint IS NULL OR id = $2) ORDER BY lower(name)',
        [userId, onlyId ?? null]);
    if (lines.rows.length === 0) return [];
    const cards = await client.query(
        `SELECT a.id, a.name, a.credit_line_id, COALESCE(b.balance_paise, 0)::bigint AS balance_paise, COALESCE(k.blocked_paise, 0)::bigint AS blocked_paise
         FROM ledger_accounts a LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         LEFT JOIN card_loan_blocked k ON k.user_id = a.user_id AND k.account_id = a.id
         WHERE a.user_id = $1 AND a.subtype = 'credit_card' AND a.archived_at IS NULL AND a.credit_line_id = ANY($2::bigint[]) ORDER BY lower(a.name)`,
        [userId, lines.rows.map(row => row.id)]);
    return lines.rows.map(row => {
        const mine = cards.rows.filter(card => Number(card.credit_line_id) === Number(row.id));
        // What the cards owe, and what loans on them block (migration 0033)
        const owed = mine.reduce((sum, card) => sum - Number(card.balance_paise) + Number(card.blocked_paise), 0);
        const limit = Number(row.limit_paise);
        return {
            id: Number(row.id), name: row.name, limit: fromPaise(limit), owed: fromPaise(Math.max(owed, 0)), available: fromPaise(limit - owed),
            cards: mine.map(card => ({ id: Number(card.id), name: card.name, owed: fromPaise(Math.max(-Number(card.balance_paise), 0) + Number(card.blocked_paise)) })),
        };
    });
}

export async function listLines(pool: Pool, userId: number): Promise<CreditLine[]> {
    return loadLines(pool, userId);
}

/** Put the cards on a line: they must be the user's cards and on no other line */
async function assignCards(client: Client, userId: number, lineId: number, cardIds: number[]): Promise<void> {
    const found = await client.query(
        "SELECT id, name, credit_line_id FROM ledger_accounts WHERE user_id = $1 AND subtype = 'credit_card' AND archived_at IS NULL AND id = ANY($2::bigint[]) FOR UPDATE",
        [userId, cardIds]);
    if (found.rows.length !== cardIds.length) throw new RequestError(400, t('errors.cards.notFound'));
    const elsewhere = found.rows.find(row => row.credit_line_id !== null && Number(row.credit_line_id) !== lineId);
    if (elsewhere) throw new RequestError(400, t('errors.cards.onAnotherLine', { name: elsewhere.name }));
    await client.query('UPDATE ledger_accounts SET credit_line_id = NULL WHERE user_id = $1 AND credit_line_id = $2 AND NOT (id = ANY($3::bigint[]))', [userId, lineId, cardIds]);
    await client.query('UPDATE ledger_accounts SET credit_line_id = $1 WHERE user_id = $2 AND id = ANY($3::bigint[])', [lineId, userId, cardIds]);
}

/** { name, limit, cardIds }: a limit shared by two or more cards */
export async function createLine(pool: Pool, userId: number, body: Body): Promise<CreditLine> {
    const name = lineName(body.name);
    const limit = limitOf(body.limit);
    const cardIds = cardIdsOf(body.cardIds);
    return withTransaction(pool, async (client) => {
        const created = await client.query('INSERT INTO credit_lines (user_id, name, limit_paise) VALUES ($1, $2, $3) RETURNING id', [userId, name, limit]);
        const id = Number(created.rows[0].id);
        await assignCards(client, userId, id, cardIds);
        await logActivity(client, userId, 'created', 'credit_line', id, `Added a shared limit: ${name}`, fromPaise(limit), null, { name, limit: fromPaise(limit), cardIds });
        return (await loadLines(client, userId, id))[0]!;
    });
}

async function lockedLine(client: Client, userId: number, id: unknown): Promise<CreditLine> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.cards.lineNotFound'));
    const lock = await client.query('SELECT id FROM credit_lines WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.cards.lineNotFound'));
    return (await loadLines(client, userId, Number(id)))[0]!;
}

/** { name?, limit?, cardIds? }: change a line */
export async function updateLine(pool: Pool, userId: number, id: string, body: Body): Promise<CreditLine> {
    return withTransaction(pool, async (client) => {
        const line = await lockedLine(client, userId, id);
        const name = body.name === undefined ? line.name : lineName(body.name);
        const limit = body.limit === undefined ? toPaise(line.limit) : limitOf(body.limit);
        await client.query('UPDATE credit_lines SET name = $1, limit_paise = $2 WHERE id = $3 AND user_id = $4', [name, limit, line.id, userId]);
        if (body.cardIds !== undefined) await assignCards(client, userId, line.id, cardIdsOf(body.cardIds));
        const updated = (await loadLines(client, userId, line.id))[0]!;
        await logActivity(client, userId, 'updated', 'credit_line', line.id, `Changed the shared limit ${name}`, updated.limit,
            { name: line.name, limit: line.limit, cardIds: line.cards.map(card => card.id) }, { name, limit: updated.limit, cardIds: updated.cards.map(card => card.id) });
        return updated;
    });
}

/** Remove a line: its cards keep their own limits */
export async function deleteLine(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const line = await lockedLine(client, userId, id);
        await client.query('UPDATE ledger_accounts SET credit_line_id = NULL WHERE user_id = $1 AND credit_line_id = $2', [userId, line.id]);
        await client.query('UPDATE credit_lines SET deleted_at = now() WHERE id = $1 AND user_id = $2', [line.id, userId]);
        await logActivity(client, userId, 'deleted', 'credit_line', line.id, `Removed the shared limit ${line.name}`, line.limit, { name: line.name }, null);
    });
}

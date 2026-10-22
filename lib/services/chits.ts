import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, systemAccount, toPaise, voidEntry } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { amountDue, chitOutcome, commissionOf, dividendFor, prize, type ChitTerms } from '../../src/core/chit';
import { addMonths } from '../../src/core/loans';
import { ensureCategories } from './categories';
import { checkCanSpend, lockedMoneyAccount } from './entries';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Chit funds (v2 Phase 3, src/core/chit.ts, migration 0030). A chit is a ledger account: what the
 * user pays in is savings in it until they win; each month's dividend is income ("Dividends"); on
 * winning, the net prize comes in, the contributions still to pay become what they owe, and the
 * discount and deductions given up are spending ("Loan interest and fees"). Several chits can run
 * at once. An informal chit is marked as higher risk (information only).
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface Chit {
    id: number;
    name: string;
    organiserKind: 'registered' | 'informal';
    organiser: string | null;
    registration: string | null;
    value: string;
    members: number;
    months: number;
    contribution: string;
    commissionPercent: string;
    commission: string;
    startedOn: string;
    auctionDay: number | null;
    /** Saved in the chit (positive) or still to pay after winning (negative) */
    balance: string;
    paid: string;
    dividends: string;
    monthsPaid: number;
    /** The next month to pay: when, and how much (less the dividend, once that month's auction is known) */
    next: { month: number; date: string; amount: string; dividendKnown: boolean } | null;
    /** Months whose payment date has passed with nothing recorded */
    missed: number;
    won: { month: number; heldOn: string; discount: string; prize: string; deductions: string; net: string } | null;
    /** The true return (saver) or cost (borrower) of winning in that month; for a chit not yet won, if it were won last */
    outcome: { role: 'saver' | 'borrower'; yearlyRate: number; gain: string; assumedMonth: number };
    instalments: { id: number; month: number; paidOn: string; contribution: string; dividend: string; paid: string }[];
    auctions: { id: number; month: number; heldOn: string; discount: string; dividend: string; wonByUser: boolean }[];
    finished: boolean;
    notes: string | null;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function paiseOf(value: unknown, allowZero = false): number {
    if ((value === undefined || value === null || value === '') && allowZero) return 0;
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise < 0 || (paise === 0 && !allowZero)) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

function dateOf(value: unknown, field: string): string {
    if (!value) throw new RequestError(400, t('errors.fieldRequired', { field }));
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.fieldNotValidDate', { field }));
    if (date.date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field }));
    return date.date;
}

// ----- Reading -----

async function loadChits(client: Client, userId: number, onlyId?: number): Promise<Chit[]> {
    const chits = await client.query(
        `SELECT c.*, c.started_on::text AS started_text, c.commission_percent::text AS commission_text, COALESCE(b.balance_paise, 0)::bigint AS balance_paise
         FROM chit_funds c LEFT JOIN ledger_account_balances b ON b.account_id = c.account_id
         WHERE c.user_id = $1 AND c.deleted_at IS NULL AND ($2::bigint IS NULL OR c.id = $2) ORDER BY c.started_on DESC, c.id DESC`, [userId, onlyId ?? null]);
    if (chits.rows.length === 0) return [];
    const ids = chits.rows.map(row => Number(row.id));
    const instalments = (await client.query(
        `SELECT id, chit_id, month, paid_on::text AS paid_on, contribution_paise, dividend_paise FROM chit_instalments
         WHERE user_id = $1 AND chit_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY month`, [userId, ids])).rows;
    const auctions = (await client.query(
        `SELECT id, chit_id, month, held_on::text AS held_on, discount_paise, won_by_user, deductions_paise FROM chit_auctions
         WHERE user_id = $1 AND chit_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY month`, [userId, ids])).rows;
    const today = todayInIndia();
    return chits.rows.map(row => {
        const id = Number(row.id);
        const terms: ChitTerms = {
            value: Number(row.value_paise), members: row.members, months: row.months, contribution: Number(row.contribution_paise), commissionPercent: Number(row.commission_text),
        };
        const paidRows = instalments.filter(item => Number(item.chit_id) === id);
        const auctionRows = auctions.filter(item => Number(item.chit_id) === id);
        const discountOf = new Map(auctionRows.map(item => [item.month as number, Number(item.discount_paise)]));
        const paidMonths = new Set(paidRows.map(item => item.month as number));
        const dateOf = (month: number) => addMonths(row.started_text, month - 1);
        const firstUnpaid = Array.from({ length: terms.months }, (_, index) => index + 1).find(month => !paidMonths.has(month)) ?? null;
        const won = auctionRows.find(item => item.won_by_user);
        const sum = (key: string) => paidRows.reduce((total, item) => total + Number(item[key]), 0);
        const contributions = sum('contribution_paise');
        const dividends = sum('dividend_paise');
        const outcomeMonth = won ? won.month as number : terms.months;
        const outcome = chitOutcome(terms, auctionRows.map(item => ({ month: item.month as number, discount: Number(item.discount_paise) })), outcomeMonth,
            won ? Number(won.deductions_paise) : 0);
        return {
            id, name: row.name, organiserKind: row.organiser_kind, organiser: row.organiser, registration: row.registration, value: fromPaise(terms.value),
            members: terms.members, months: terms.months, contribution: fromPaise(terms.contribution), commissionPercent: String(Number(row.commission_text)),
            commission: fromPaise(commissionOf(terms)), startedOn: row.started_text, auctionDay: row.auction_day, balance: fromPaise(Number(row.balance_paise)),
            paid: fromPaise(contributions - dividends), dividends: fromPaise(dividends), monthsPaid: paidRows.length,
            next: firstUnpaid === null ? null : {
                month: firstUnpaid, date: dateOf(firstUnpaid),
                amount: fromPaise(discountOf.has(firstUnpaid) ? amountDue(terms, discountOf.get(firstUnpaid)!) : terms.contribution),
                dividendKnown: discountOf.has(firstUnpaid),
            },
            missed: Array.from({ length: terms.months }, (_, index) => index + 1).filter(month => !paidMonths.has(month) && dateOf(month) < today).length,
            won: won ? {
                month: won.month, heldOn: won.held_on, discount: fromPaise(Number(won.discount_paise)),
                prize: fromPaise(prize(terms, Number(won.discount_paise))), deductions: fromPaise(Number(won.deductions_paise)),
                net: fromPaise(prize(terms, Number(won.discount_paise), Number(won.deductions_paise))),
            } : null,
            outcome: { role: outcome.role, yearlyRate: outcome.yearlyRate, gain: fromPaise(outcome.gain), assumedMonth: outcomeMonth },
            instalments: paidRows.map(item => ({
                id: Number(item.id), month: item.month, paidOn: item.paid_on, contribution: fromPaise(Number(item.contribution_paise)),
                dividend: fromPaise(Number(item.dividend_paise)), paid: fromPaise(Number(item.contribution_paise) - Number(item.dividend_paise)),
            })),
            auctions: auctionRows.map(item => ({
                id: Number(item.id), month: item.month, heldOn: item.held_on, discount: fromPaise(Number(item.discount_paise)),
                dividend: fromPaise(dividendFor(terms, Number(item.discount_paise))), wonByUser: item.won_by_user,
            })),
            finished: paidRows.length >= terms.months && Number(row.balance_paise) <= 0,
            notes: row.notes,
        };
    });
}

export async function listChits(pool: Pool, userId: number): Promise<Chit[]> {
    return loadChits(pool, userId);
}

async function lockedChit(client: Client, userId: number, id: unknown): Promise<Chit & { accountId: number }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.chits.notFound'));
    const lock = await client.query('SELECT account_id FROM chit_funds WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.chits.notFound'));
    return { ...(await loadChits(client, userId, Number(id)))[0]!, accountId: Number(lock.rows[0].account_id) };
}

async function categoryByKey(client: Client, userId: number, key: string, kind: 'income' | 'expense'): Promise<number> {
    await ensureCategories(client, userId);
    const found = await client.query('SELECT id FROM ledger_accounts WHERE user_id = $1 AND category_key = $2 AND archived_at IS NULL', [userId, key]);
    return found.rows[0] ? Number(found.rows[0].id) : systemAccount(client, userId, kind);
}

// ----- Changes -----

/** { name, organiserKind, organiser?, registration?, value, members, months, contribution?, commissionPercent?, startedOn, auctionDay?, notes? } */
export async function createChit(pool: Pool, userId: number, body: Body): Promise<Chit> {
    const name = text(body.name);
    if (!name) throw new RequestError(400, t('errors.chits.nameRequired'));
    if (name.length > 80) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 80 }));
    const organiserKind = body.organiserKind === 'registered' ? 'registered' : body.organiserKind === 'informal' ? 'informal' : null;
    if (!organiserKind) throw new RequestError(400, t('errors.chits.badOrganiser'));
    const value = paiseOf(body.value);
    const members = Number(body.members);
    const months = Number(body.months ?? body.members);
    if (!Number.isInteger(members) || members < 2 || members > 200) throw new RequestError(400, t('errors.chits.badMembers'));
    if (!Number.isInteger(months) || months < 2 || months > 200) throw new RequestError(400, t('errors.chits.badMonths'));
    const contribution = body.contribution ? paiseOf(body.contribution) : Math.round(value / members);
    const commission = body.commissionPercent === undefined || body.commissionPercent === '' ? 5 : Number(body.commissionPercent);
    if (!Number.isFinite(commission) || commission < 0 || commission > 10) throw new RequestError(400, t('errors.chits.badCommission'));
    if (!body.startedOn) throw new RequestError(400, t('errors.fieldRequired', { field: t('errors.chits.startField') }));
    const started = entryDate(body.startedOn);
    if (!started) throw new RequestError(400, t('errors.fieldNotValidDate', { field: t('errors.chits.startField') }));
    const auctionDay = body.auctionDay === undefined || body.auctionDay === '' || body.auctionDay === null ? null : Number(body.auctionDay);
    if (auctionDay !== null && (!Number.isInteger(auctionDay) || auctionDay < 1 || auctionDay > 31)) throw new RequestError(400, t('errors.chits.badDay'));
    return withTransaction(pool, async (client) => {
        const account = await client.query('INSERT INTO ledger_accounts (user_id, kind, subtype, name, institution) VALUES ($1, \'asset\', \'chit\', $2, $3) RETURNING id',
            [userId, name, text(body.organiser) || null]);
        const created = await client.query(
            `INSERT INTO chit_funds (user_id, account_id, name, organiser_kind, organiser, registration, value_paise, members, months, contribution_paise,
                                     commission_percent, started_on, auction_day, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [userId, account.rows[0].id, name, organiserKind, text(body.organiser).slice(0, 100) || null, text(body.registration).slice(0, 100) || null,
                value, members, months, contribution, commission, started.date, auctionDay, text(body.notes).slice(0, 500) || null]);
        const id = Number(created.rows[0].id);
        await logActivity(client, userId, 'created', 'chit', id, `Added chit: ${name}`, fromPaise(value), null,
            { name, organiserKind, value: fromPaise(value), members, months, contribution: fromPaise(contribution) });
        return (await loadChits(client, userId, id))[0]!;
    });
}

/** { month, accountId, date, dividend? }: a month's payment; the dividend defaults to that month's auction's */
export async function payInstalment(pool: Pool, userId: number, id: string, body: Body): Promise<Chit> {
    const date = dateOf(body.date, t('errors.people.dateField'));
    return withTransaction(pool, async (client) => {
        const chit = await lockedChit(client, userId, id);
        const month = Number(body.month ?? chit.next?.month);
        if (!Number.isInteger(month) || month < 1 || month > chit.months) throw new RequestError(400, t('errors.chits.badMonth', { months: chit.months }));
        if (chit.instalments.some(item => item.month === month)) throw new RequestError(400, t('errors.chits.alreadyPaid', { month }));
        const contribution = toPaise(chit.contribution);
        const auction = chit.auctions.find(item => item.month === month);
        const dividend = body.dividend === undefined || body.dividend === null || body.dividend === ''
            ? (auction ? toPaise(auction.dividend) : 0) : paiseOf(body.dividend, true);
        if (dividend >= contribution) throw new RequestError(400, t('errors.chits.badDividend'));
        const paid = contribution - dividend;
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        await checkCanSpend(client, userId, account, paid);
        const entryId = await postEntry(client, {
            userId, date, type: 'chit', description: t('chits.entry.instalment', { name: chit.name, month }),
            lines: [{ accountId: chit.accountId, paise: contribution }, { accountId: account.id, paise: -paid }, { accountId: await categoryByKey(client, userId, 'dividends', 'income'), paise: -dividend }],
        });
        await client.query('INSERT INTO chit_instalments (user_id, chit_id, month, paid_on, contribution_paise, dividend_paise, entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [userId, chit.id, month, date, contribution, dividend, entryId]);
        await logActivity(client, userId, 'created', 'chit', chit.id, `Paid ${chit.name}, month ${month}`, fromPaise(paid), null,
            { name: chit.name, month, contribution: fromPaise(contribution), dividend: fromPaise(dividend), paid: fromPaise(paid), date });
        return (await loadChits(client, userId, chit.id))[0]!;
    });
}

/**
 * { month, heldOn, discount, wonByUser?, deductions?, accountId? }: a month's auction. Won by the
 * user: the net prize comes into accountId, and what is left to pay becomes owed.
 */
export async function recordAuction(pool: Pool, userId: number, id: string, body: Body): Promise<Chit> {
    const heldOn = dateOf(body.heldOn, t('errors.chits.heldField'));
    const discount = paiseOf(body.discount, true);
    const wonByUser = body.wonByUser === true;
    const deductions = paiseOf(body.deductions, true);
    return withTransaction(pool, async (client) => {
        const chit = await lockedChit(client, userId, id);
        const month = Number(body.month);
        if (!Number.isInteger(month) || month < 1 || month > chit.months) throw new RequestError(400, t('errors.chits.badMonth', { months: chit.months }));
        if (chit.auctions.some(item => item.month === month)) throw new RequestError(400, t('errors.chits.auctionExists', { month }));
        if (discount >= toPaise(chit.value)) throw new RequestError(400, t('errors.chits.badDiscount'));
        let entryId: number | null = null;
        if (wonByUser) {
            if (chit.won) throw new RequestError(400, t('errors.chits.alreadyWon'));
            const terms: ChitTerms = { value: toPaise(chit.value), members: chit.members, months: chit.months, contribution: toPaise(chit.contribution), commissionPercent: Number(chit.commissionPercent) };
            const net = prize(terms, discount, deductions);
            const commitment = terms.contribution * terms.months;
            const account = await lockedMoneyAccount(client, userId, body.accountId);
            entryId = await postEntry(client, {
                userId, date: heldOn, type: 'chit', description: t('chits.entry.won', { name: chit.name, month }),
                lines: [
                    { accountId: account.id, paise: net }, { accountId: chit.accountId, paise: -commitment },
                    { accountId: await categoryByKey(client, userId, 'loan_interest', 'expense'), paise: commitment - net },
                ],
            });
        }
        await client.query('INSERT INTO chit_auctions (user_id, chit_id, month, held_on, discount_paise, won_by_user, deductions_paise, entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [userId, chit.id, month, heldOn, discount, wonByUser, deductions, entryId]);
        await logActivity(client, userId, 'created', 'chit', chit.id, `${wonByUser ? 'Won' : 'Auction of'} ${chit.name}, month ${month}`, fromPaise(discount), null,
            { name: chit.name, month, discount: fromPaise(discount), wonByUser, deductions: fromPaise(deductions) });
        return (await loadChits(client, userId, chit.id))[0]!;
    });
}

/** Remove a payment or an auction recorded by mistake: its entry is voided */
export async function deleteChitRecord(pool: Pool, userId: number, id: string, kind: 'instalments' | 'auctions', recordId: string): Promise<Chit> {
    return withTransaction(pool, async (client) => {
        const chit = await lockedChit(client, userId, id);
        const table = kind === 'instalments' ? 'chit_instalments' : 'chit_auctions';
        const found = await client.query(`SELECT id, entry_id FROM ${table} WHERE id = $1 AND chit_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE`,
            [/^\d+$/.test(recordId) ? recordId : 0, chit.id, userId]);
        const row = found.rows[0];
        if (!row) throw new RequestError(404, t('errors.chits.recordNotFound'));
        if (row.entry_id !== null) await voidEntry(client, userId, Number(row.entry_id));
        await client.query(`UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [row.id, userId]);
        await logActivity(client, userId, 'deleted', 'chit', chit.id, `Removed a ${kind === 'instalments' ? 'payment' : 'auction'} of ${chit.name}`, null, { record: Number(row.id) }, null);
        return (await loadChits(client, userId, chit.id))[0]!;
    });
}

/** Remove a chit entered by mistake: its entries are voided, its account archived */
export async function deleteChit(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const chit = await lockedChit(client, userId, id);
        const entries = await client.query(
            `SELECT entry_id FROM chit_instalments WHERE chit_id = $1 AND user_id = $2 AND entry_id IS NOT NULL AND deleted_at IS NULL
             UNION SELECT entry_id FROM chit_auctions WHERE chit_id = $1 AND user_id = $2 AND entry_id IS NOT NULL AND deleted_at IS NULL`, [chit.id, userId]);
        for (const row of entries.rows) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE chit_funds SET deleted_at = now() WHERE id = $1 AND user_id = $2', [chit.id, userId]);
        await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE id = $1 AND user_id = $2', [chit.accountId, userId]);
        await logActivity(client, userId, 'deleted', 'chit', chit.id, `Removed chit: ${chit.name}`, chit.value, { name: chit.name }, null);
    });
}

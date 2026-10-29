import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, toPaise, voidEntry } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import {
    dueDateFor, minimumDueOf, monthsInterest, statementDates, statementState, trueYearlyRate, type StatementStatus,
} from '../../src/core/cards';
import { perHundredMonthly, yearlyRate, type RateUnit } from '../../src/core/interest';
import { categoryByKey } from './categories';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Credit card statements (v2 Phase 4, src/core/cards.ts, migration 0031). A card's billing and due
 * days give its statement dates; the latest statement is worked out from the ledger (what was owed
 * on its date) unless the user recorded the bank's figures for that date. Payments are money into
 * the card after the statement date: by the due date they decide whether the bill was paid, only
 * the minimum was paid (the rest carried, and charged interest), or it is overdue.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface CardStatement {
    /** The recorded statement's id; null when worked out from the ledger */
    id: number | null;
    date: string;
    dueOn: string;
    amountDue: string;
    minimumDue: string;
    interest: string;
    fees: string;
    /** What the ledger has owed on the statement date (for a recorded one, to compare with the bank's) */
    ledgerAmount: string;
    paid: string;
    paidByDue: string;
    left: string;
    status: StatementStatus;
    overdue: boolean;
    carried: string;
    /** About a month's interest on what is carried (or would be, if only the minimum is paid) */
    interestIfCarried: string | null;
    dueSoon: boolean;
    daysLeft: number;
}

export interface Card {
    /** The card's ledger account id (as in /api/accounts) */
    id: number;
    /** The /api/credit-cards id */
    sourceId: number | null;
    name: string;
    owed: string;
    creditLimit: string | null;
    available: string | null;
    /** % a year, ₹ per ₹100 a month, and the true yearly cost; null until entered */
    interestRate: string | null;
    perHundredMonthly: string | null;
    trueRate: number | null;
    billingDay: number | null;
    dueDay: number | null;
    /** The credit line it shares (migration 0032); `available` above is already limited by it */
    line: { id: number; name: string; limit: string; available: string } | null;
    /** The latest statement, once the billing and due days are set */
    statement: CardStatement | null;
    /** Spent on the card since the latest statement */
    sinceStatement: string;
    /** Statements recorded from the bank, latest first */
    history: { id: number; date: string; dueOn: string; amountDue: string; minimumDue: string; interest: string; fees: string }[];
}

interface CardRow {
    id: string; source_id: string | null; name: string; credit_limit_paise: string | null; interest_rate: string | null;
    billing_day: number | null; due_day: number | null; balance_paise: string;
    line_id: string | null; line_name: string | null; line_limit_paise: string | null; line_owed_paise: string | null;
}

interface StatementRow {
    id: string; account_id: string; statement_date: string; due_on: string; amount_due_paise: string; minimum_due_paise: string; interest_paise: string; fees_paise: string;
}

function paiseOf(value: unknown, allowZero = true): number {
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

function dateOf(value: unknown, field: string, allowFuture = false): string {
    if (!value) throw new RequestError(400, t('errors.fieldRequired', { field }));
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.fieldNotValidDate', { field }));
    if (!allowFuture && date.date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field }));
    return date.date;
}

function dayOf(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new RequestError(400, t('errors.cards.badDay'));
    return day;
}

// ----- Reading -----

/** What the card was owed on a date, and the payments into it after one date up to another */
async function owedOn(client: Client, userId: number, accountId: number, date: string): Promise<number> {
    const result = await client.query(
        `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE l.user_id = $1 AND l.account_id = $2 AND e.voided_at IS NULL AND e.entry_date <= $3::date`, [userId, accountId, date]);
    return Math.max(-Number(result.rows[0].paise), 0);
}

async function paymentsBetween(client: Client, userId: number, accountId: number, after: string, upTo: string): Promise<number> {
    const result = await client.query(
        `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS paise FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE l.user_id = $1 AND l.account_id = $2 AND e.voided_at IS NULL AND e.entry_type = 'transfer' AND l.amount_paise > 0
           AND e.entry_date > $3::date AND e.entry_date <= $4::date`, [userId, accountId, after, upTo]);
    return Number(result.rows[0].paise);
}

async function loadCards(client: Client, userId: number, onlyId?: number): Promise<Card[]> {
    const cards = await client.query(
        `SELECT a.id, a.source_id, a.name, a.credit_limit_paise, a.interest_rate::text AS interest_rate, a.billing_day, a.due_day,
                COALESCE(b.balance_paise, 0)::bigint AS balance_paise, c.id AS line_id, c.name AS line_name, c.limit_paise AS line_limit_paise,
                (SELECT -COALESCE(SUM(sb.balance_paise), 0) FROM ledger_accounts s JOIN ledger_account_balances sb ON sb.account_id = s.id
                 WHERE s.user_id = a.user_id AND s.credit_line_id = c.id AND s.archived_at IS NULL)::bigint AS line_owed_paise
         FROM ledger_accounts a LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         LEFT JOIN credit_lines c ON c.user_id = a.user_id AND c.id = a.credit_line_id AND c.deleted_at IS NULL
         WHERE a.user_id = $1 AND a.subtype = 'credit_card' AND a.archived_at IS NULL AND ($2::bigint IS NULL OR a.id = $2)
         ORDER BY lower(a.name)`, [userId, onlyId ?? null]);
    if (cards.rows.length === 0) return [];
    const statements = (await client.query(
        `SELECT id, account_id, statement_date::text AS statement_date, due_on::text AS due_on, amount_due_paise, minimum_due_paise, interest_paise, fees_paise
         FROM card_statements WHERE user_id = $1 AND account_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY statement_date DESC`,
        [userId, cards.rows.map(row => row.id)])).rows as StatementRow[];
    const today = todayInIndia();
    const result: Card[] = [];
    for (const row of cards.rows as CardRow[]) {
        const id = Number(row.id);
        const owed = Math.max(-Number(row.balance_paise), 0);
        const limit = row.credit_limit_paise === null ? null : Number(row.credit_limit_paise);
        const lineRoom = row.line_id === null ? null : Number(row.line_limit_paise) - Number(row.line_owed_paise);
        const room = limit === null ? null : lineRoom === null ? limit - owed : Math.min(limit - owed, lineRoom);
        const rate = row.interest_rate === null ? null : String(Number(row.interest_rate));
        const recorded = statements.filter(item => Number(item.account_id) === id);
        let statement: CardStatement | null = null;
        let sinceStatement = owed;
        // The latest statement: the latest recorded one, or the one the billing day gives if later
        const billed = row.billing_day !== null && row.due_day !== null ? statementDates(row.billing_day, today).current : null;
        const latestRecorded = recorded[0];
        const useRecorded = latestRecorded && (billed === null || latestRecorded.statement_date >= billed);
        if (useRecorded || billed) {
            const date = useRecorded ? latestRecorded.statement_date : billed!;
            const ledgerAmount = await owedOn(client, userId, id, date);
            const amountDue = useRecorded ? Number(latestRecorded.amount_due_paise) : ledgerAmount;
            const minimumDue = useRecorded ? Number(latestRecorded.minimum_due_paise) : minimumDueOf(amountDue);
            const dueOn = useRecorded ? latestRecorded.due_on : dueDateFor(date, row.due_day!);
            const paid = await paymentsBetween(client, userId, id, date, today);
            const paidByDue = await paymentsBetween(client, userId, id, date, dueOn < today ? dueOn : today);
            const state = statementState({ amountDue, minimumDue, dueOn }, paidByDue, paid, today);
            const carrying = state.carried > 0 ? state.carried : Math.max(amountDue - minimumDue, 0);
            statement = {
                id: useRecorded ? Number(latestRecorded.id) : null, date, dueOn, amountDue: fromPaise(amountDue), minimumDue: fromPaise(minimumDue),
                interest: fromPaise(useRecorded ? Number(latestRecorded.interest_paise) : 0), fees: fromPaise(useRecorded ? Number(latestRecorded.fees_paise) : 0),
                ledgerAmount: fromPaise(ledgerAmount), paid: fromPaise(paid), paidByDue: fromPaise(paidByDue), left: fromPaise(state.left), status: state.status,
                overdue: state.overdue, carried: fromPaise(state.carried), interestIfCarried: rate === null ? null : fromPaise(monthsInterest(carrying, Number(rate))),
                dueSoon: state.dueSoon, daysLeft: state.daysLeft,
            };
            sinceStatement = Math.max(owed - state.left, 0);
        }
        result.push({
            id, sourceId: row.source_id === null ? null : Number(row.source_id), name: row.name, owed: fromPaise(owed),
            creditLimit: limit === null ? null : fromPaise(limit), available: room === null ? null : fromPaise(room),
            line: row.line_id === null ? null : { id: Number(row.line_id), name: row.line_name!, limit: fromPaise(Number(row.line_limit_paise)), available: fromPaise(lineRoom!) },
            interestRate: rate, perHundredMonthly: rate === null ? null : perHundredMonthly(rate), trueRate: rate === null ? null : trueYearlyRate(Number(rate)),
            billingDay: row.billing_day, dueDay: row.due_day, statement, sinceStatement: fromPaise(sinceStatement),
            history: recorded.map(item => ({
                id: Number(item.id), date: item.statement_date, dueOn: item.due_on, amountDue: fromPaise(Number(item.amount_due_paise)),
                minimumDue: fromPaise(Number(item.minimum_due_paise)), interest: fromPaise(Number(item.interest_paise)), fees: fromPaise(Number(item.fees_paise)),
            })),
        });
    }
    return result;
}

export async function listCards(pool: Pool, userId: number): Promise<Card[]> {
    return loadCards(pool, userId);
}

async function lockedCard(client: Client, userId: number, id: unknown): Promise<Card> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.cards.notFound'));
    const lock = await client.query("SELECT id FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND subtype = 'credit_card' AND archived_at IS NULL FOR UPDATE", [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.cards.notFound'));
    return (await loadCards(client, userId, Number(id)))[0]!;
}

// ----- Changes -----

/** { billingDay?, dueDay?, interestRate?, rateUnit? }: a card's statement days and interest rate */
export async function setCardTerms(pool: Pool, userId: number, id: string, body: Body): Promise<Card> {
    const billingDay = dayOf(body.billingDay);
    const dueDay = dayOf(body.dueDay);
    if ((billingDay === null) !== (dueDay === null)) throw new RequestError(400, t('errors.cards.bothDays'));
    if (billingDay !== null && billingDay === dueDay) throw new RequestError(400, t('errors.cards.sameDays'));
    let rate: string | null = null;
    if (body.interestRate !== undefined && body.interestRate !== null && body.interestRate !== '') {
        if (body.rateUnit !== undefined && body.rateUnit !== 'year' && body.rateUnit !== 'per100month') throw new RequestError(400, t('errors.loans.badRate'));
        rate = yearlyRate(String(body.interestRate), (body.rateUnit ?? 'year') as RateUnit);
        if (rate === null) throw new RequestError(400, t('errors.loans.badRate'));
    }
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        await client.query('UPDATE ledger_accounts SET billing_day = $1, due_day = $2, interest_rate = $3 WHERE id = $4 AND user_id = $5',
            [billingDay, dueDay, rate, card.id, userId]);
        await logActivity(client, userId, 'updated', 'credit_card', card.id, `Changed the statement days and rate of ${card.name}`, null,
            { billingDay: card.billingDay, dueDay: card.dueDay, interestRate: card.interestRate }, { billingDay, dueDay, interestRate: rate });
        return (await loadCards(client, userId, card.id))[0]!;
    });
}

/**
 * { statementDate, dueOn?, amountDue, minimumDue?, interest?, fees? }: the bank's statement. Interest
 * and fees on it go on the card as spending ("Loan interest and fees"), dated the statement date.
 */
export async function recordStatement(pool: Pool, userId: number, id: string, body: Body): Promise<Card> {
    const date = dateOf(body.statementDate, t('errors.cards.statementDateField'));
    const amountDue = paiseOf(body.amountDue);
    if (body.amountDue === undefined || body.amountDue === null || body.amountDue === '') throw new RequestError(400, t('errors.fieldRequired', { field: t('errors.cards.amountDueField') }));
    const minimumDue = body.minimumDue === undefined || body.minimumDue === null || body.minimumDue === '' ? minimumDueOf(amountDue) : paiseOf(body.minimumDue);
    if (minimumDue > amountDue) throw new RequestError(400, t('errors.cards.minimumTooHigh'));
    const interest = paiseOf(body.interest);
    const fees = paiseOf(body.fees);
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        const dueOn = body.dueOn ? dateOf(body.dueOn, t('errors.cards.dueOnField'), true)
            : card.dueDay !== null ? dueDateFor(date, card.dueDay) : null;
        if (!dueOn) throw new RequestError(400, t('errors.fieldRequired', { field: t('errors.cards.dueOnField') }));
        if (dueOn <= date) throw new RequestError(400, t('errors.cards.dueBeforeStatement'));
        const clash = await client.query('SELECT 1 FROM card_statements WHERE account_id = $1 AND user_id = $2 AND statement_date = $3 AND deleted_at IS NULL',
            [card.id, userId, date]);
        if (clash.rows.length > 0) throw new RequestError(400, t('errors.cards.statementExists', { date }));
        const entryId = await postEntry(client, {
            userId, date, type: 'card_charges', description: t('cards.entry', { name: card.name }),
            lines: [{ accountId: card.id, paise: -(interest + fees) }, { accountId: await categoryByKey(client, userId, 'loan_interest', 'expense'), paise: interest + fees }],
        });
        await client.query(
            `INSERT INTO card_statements (user_id, account_id, statement_date, due_on, amount_due_paise, minimum_due_paise, interest_paise, fees_paise, entry_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [userId, card.id, date, dueOn, amountDue, minimumDue, interest, fees, entryId]);
        await logActivity(client, userId, 'created', 'card_statement', card.id, `Recorded the ${date} statement of ${card.name}`, fromPaise(amountDue), null,
            { date, dueOn, amountDue: fromPaise(amountDue), minimumDue: fromPaise(minimumDue), interest: fromPaise(interest), fees: fromPaise(fees) });
        return (await loadCards(client, userId, card.id))[0]!;
    });
}

/** Remove a statement recorded by mistake: its interest and fees entry is voided */
export async function deleteStatement(pool: Pool, userId: number, id: string, statementId: string): Promise<Card> {
    return withTransaction(pool, async (client) => {
        const card = await lockedCard(client, userId, id);
        const found = await client.query('SELECT id, statement_date::text AS statement_date, entry_id FROM card_statements WHERE id = $1 AND account_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE',
            [/^\d+$/.test(statementId) ? statementId : 0, card.id, userId]);
        const row = found.rows[0];
        if (!row) throw new RequestError(404, t('errors.cards.statementNotFound'));
        if (row.entry_id !== null) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE card_statements SET deleted_at = now() WHERE id = $1 AND user_id = $2', [row.id, userId]);
        await logActivity(client, userId, 'deleted', 'card_statement', card.id, `Removed the ${row.statement_date} statement of ${card.name}`, null, { statement: Number(row.id) }, null);
        return (await loadCards(client, userId, card.id))[0]!;
    });
}

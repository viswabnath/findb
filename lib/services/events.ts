import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { listEntriesForEvent, type Entry } from './entries';
import { entryDate } from './transactions';

/**
 * Events and projects (docs/ledger.md): a named purpose ("Sister's wedding", "Goa trip") that
 * any entry can carry alongside its category. An event shows what was spent on it by category,
 * what was received, the net cost, the budget against what was spent, which accounts paid, and a
 * timeline. A one-off event can be left out of regular spending.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface EventSummary {
    id: number;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
    budget: string | null;
    oneOff: boolean;
    notes: string | null;
    /** Spending on it, money received for it, and spending less receipts */
    spent: string;
    received: string;
    netCost: string;
    /** What is left of the budget (negative when over), or null without a budget */
    budgetLeft: string | null;
    entries: number;
    firstDate: string | null;
    lastDate: string | null;
}

export interface EventDetail extends EventSummary {
    spentByCategory: { id: number; name: string; amount: string }[];
    receivedByCategory: { id: number; name: string; amount: string }[];
    /** How the spending was paid for: by the account the money left */
    paidFrom: { id: number; name: string; type: string; amount: string }[];
    /** Every entry for it, newest first */
    timeline: Entry[];
}

const SUMMARY_QUERY = `
    SELECT ev.id, ev.name, ev.starts_on::text AS starts_on, ev.ends_on::text AS ends_on, ev.budget_paise, ev.one_off, ev.notes,
           COALESCE(SUM(l.amount_paise) FILTER (WHERE a.kind = 'expense'), 0)::bigint AS spent,
           COALESCE(-SUM(l.amount_paise) FILTER (WHERE a.kind = 'income'), 0)::bigint AS received,
           COUNT(DISTINCT e.id)::int AS entries, MIN(e.entry_date)::text AS first_date, MAX(e.entry_date)::text AS last_date
    FROM events ev
    LEFT JOIN journal_entries e ON e.user_id = ev.user_id AND e.event_id = ev.id AND e.voided_at IS NULL
    LEFT JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
    LEFT JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
    WHERE ev.user_id = $1 AND ev.archived_at IS NULL`;

function toSummary(row: Record<string, unknown>): EventSummary {
    const spent = Number(row.spent);
    const received = Number(row.received);
    const budget = row.budget_paise === null ? null : Number(row.budget_paise);
    return {
        id: Number(row.id),
        name: String(row.name),
        startsOn: (row.starts_on as string | null) ?? null,
        endsOn: (row.ends_on as string | null) ?? null,
        budget: budget === null ? null : fromPaise(budget),
        oneOff: row.one_off === true,
        notes: (row.notes as string | null) ?? null,
        spent: fromPaise(spent),
        received: fromPaise(received),
        netCost: fromPaise(spent - received),
        budgetLeft: budget === null ? null : fromPaise(budget - spent),
        entries: Number(row.entries),
        firstDate: (row.first_date as string | null) ?? null,
        lastDate: (row.last_date as string | null) ?? null,
    };
}

/** Every event that is not archived, with its totals, the latest first */
export async function listEvents(pool: Pool, userId: number): Promise<EventSummary[]> {
    const result = await pool.query(
        `${SUMMARY_QUERY} GROUP BY ev.id ORDER BY coalesce(ev.starts_on, MAX(e.entry_date), ev.created_at::date) DESC, ev.id DESC`,
        [userId]);
    return result.rows.map(toSummary);
}

/** One of the user's events that is not archived, locked; 400 otherwise */
export async function lockedEvent(client: Client, userId: number, id: unknown): Promise<{ id: number; name: string; oneOff: boolean }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(400, 'Event not found');
    const result = await client.query(
        'SELECT id, name, one_off FROM events WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE', [id, userId]);
    const row = result.rows[0];
    if (!row) throw new RequestError(400, 'Event not found');
    return { id: Number(row.id), name: row.name, oneOff: row.one_off };
}

interface EventInput { name: string; startsOn: string | null; endsOn: string | null; budgetPaise: number | null; oneOff: boolean; notes: string | null }

function optionalDate(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const date = entryDate(value);
    if (!date) throw new RequestError(400, `${field} is not a valid date`);
    return date.date;
}

function readEvent(body: Body, current?: EventInput): EventInput {
    const pick = <K extends keyof EventInput>(key: K, read: () => EventInput[K]): EventInput[K] =>
        (body[key === 'budgetPaise' ? 'budget' : key] === undefined && current ? current[key] : read());
    const name = pick('name', () => {
        if (typeof body.name !== 'string' || !body.name.trim()) throw new RequestError(400, 'Event name is required');
        if (body.name.trim().length > 80) throw new RequestError(400, 'Event name is too long (max 80 characters)');
        return body.name.trim();
    });
    const startsOn = pick('startsOn', () => optionalDate(body.startsOn, 'Start date'));
    const endsOn = pick('endsOn', () => optionalDate(body.endsOn, 'End date'));
    if (startsOn && endsOn && endsOn < startsOn) throw new RequestError(400, 'The end date is before the start date');
    const budgetPaise = pick('budgetPaise', () => {
        if (body.budget === undefined || body.budget === null || body.budget === '') return null;
        let paise: number;
        try {
            paise = toPaise(body.budget);
        } catch {
            throw new RequestError(400, 'Enter a valid budget');
        }
        if (paise < 0) throw new RequestError(400, 'A budget cannot be negative');
        return paise;
    });
    const oneOff = pick('oneOff', () => {
        if (body.oneOff === undefined) return true;
        if (typeof body.oneOff !== 'boolean') throw new RequestError(400, 'One-off must be true or false');
        return body.oneOff;
    });
    const notes = pick('notes', () => {
        if (body.notes === undefined || body.notes === null || body.notes === '') return null;
        if (typeof body.notes !== 'string' || body.notes.length > 500) throw new RequestError(400, 'Notes must be text, up to 500 characters');
        return body.notes.trim() || null;
    });
    return { name, startsOn, endsOn, budgetPaise, oneOff, notes };
}

async function refuseDuplicate(client: Client, userId: number, name: string, exceptId = 0): Promise<void> {
    const clash = await client.query(
        'SELECT 1 FROM events WHERE user_id = $1 AND archived_at IS NULL AND lower(name) = lower($2) AND id <> $3', [userId, name, exceptId]);
    if (clash.rows.length > 0) throw new RequestError(400, `You already have an event called ${name}`);
}

async function summaryOf(client: Client, userId: number, id: number): Promise<EventSummary> {
    const result = await client.query(`${SUMMARY_QUERY} AND ev.id = $2 GROUP BY ev.id`, [userId, id]);
    if (!result.rows[0]) throw new RequestError(404, 'Event not found');
    return toSummary(result.rows[0]);
}

/** { name, startsOn?, endsOn?, budget?, oneOff? (default true), notes? } */
export async function createEvent(pool: Pool, userId: number, body: Body): Promise<EventSummary> {
    const input = readEvent(body);
    return withTransaction(pool, async (client) => {
        await refuseDuplicate(client, userId, input.name);
        const created = await client.query(
            'INSERT INTO events (user_id, name, starts_on, ends_on, budget_paise, one_off, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [userId, input.name, input.startsOn, input.endsOn, input.budgetPaise, input.oneOff, input.notes]);
        const id = Number(created.rows[0].id);
        await logActivity(client, userId, 'created', 'event', id, `Added event: ${input.name}`,
            input.budgetPaise === null ? null : fromPaise(input.budgetPaise), null, { eventName: input.name, oneOff: input.oneOff });
        return summaryOf(client, userId, id);
    });
}

/** The same fields as creating one; any left out stay as they are */
export async function updateEvent(pool: Pool, userId: number, id: string, body: Body): Promise<EventSummary> {
    return withTransaction(pool, async (client) => {
        await lockedEvent(client, userId, id);
        const current = await client.query(
            'SELECT name, starts_on::text AS starts_on, ends_on::text AS ends_on, budget_paise, one_off, notes FROM events WHERE id = $1 AND user_id = $2',
            [id, userId]);
        const row = current.rows[0];
        const before: EventInput = {
            name: row.name, startsOn: row.starts_on, endsOn: row.ends_on,
            budgetPaise: row.budget_paise === null ? null : Number(row.budget_paise), oneOff: row.one_off, notes: row.notes,
        };
        const input = readEvent(body, before);
        if (input.name.toLowerCase() !== before.name.toLowerCase()) await refuseDuplicate(client, userId, input.name, Number(id));
        await client.query(
            'UPDATE events SET name = $1, starts_on = $2, ends_on = $3, budget_paise = $4, one_off = $5, notes = $6 WHERE id = $7 AND user_id = $8',
            [input.name, input.startsOn, input.endsOn, input.budgetPaise, input.oneOff, input.notes, id, userId]);
        await logActivity(client, userId, 'updated', 'event', Number(id), `Updated event: ${input.name}`, null,
            { eventName: before.name, oneOff: before.oneOff }, { eventName: input.name, oneOff: input.oneOff });
        return summaryOf(client, userId, Number(id));
    });
}

/** Archive an event: it leaves the lists, and its entries keep it in their history */
export async function archiveEvent(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const event = await lockedEvent(client, userId, id);
        await client.query('UPDATE events SET archived_at = now() WHERE id = $1 AND user_id = $2', [event.id, userId]);
        await logActivity(client, userId, 'deleted', 'event', event.id, `Removed event: ${event.name}`, null, { eventName: event.name }, null);
    });
}

/** An event with its breakdowns and timeline */
export async function eventDetail(pool: Pool, userId: number, id: string): Promise<EventDetail> {
    if (!/^\d+$/.test(id)) throw new RequestError(404, 'Event not found');
    const summary = await summaryOf(pool, userId, Number(id));
    const byAccount = await pool.query(
        `SELECT a.id, a.name, a.kind, a.subtype, SUM(l.amount_paise)::bigint AS paise
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE e.user_id = $1 AND e.event_id = $2 AND e.voided_at IS NULL
         GROUP BY a.id ORDER BY paise DESC`,
        [userId, id]);
    // The money accounts each expense was paid from
    const paidFrom = await pool.query(
        `SELECT a.id, a.name, a.subtype, -SUM(l.amount_paise)::bigint AS paise
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE e.user_id = $1 AND e.event_id = $2 AND e.voided_at IS NULL AND e.entry_type = 'expense'
           AND a.kind IN ('asset', 'liability')
         GROUP BY a.id ORDER BY paise DESC`,
        [userId, id]);
    const rows = byAccount.rows;
    return {
        ...summary,
        spentByCategory: rows.filter(row => row.kind === 'expense')
            .map(row => ({ id: Number(row.id), name: row.name, amount: fromPaise(row.paise) })),
        receivedByCategory: rows.filter(row => row.kind === 'income').reverse()
            .map(row => ({ id: Number(row.id), name: row.name, amount: fromPaise(-Number(row.paise)) })),
        paidFrom: paidFrom.rows.map(row => ({ id: Number(row.id), name: row.name, type: row.subtype, amount: fromPaise(row.paise) })),
        timeline: await listEntriesForEvent(pool, userId, Number(id)),
    };
}

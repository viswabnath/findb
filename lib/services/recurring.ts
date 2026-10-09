import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { nextAfter, nextOnOrAfter, occurrences, ruleProblem, addDays, type Frequency, type Rule } from '../../src/core/schedule';
import { lockedCategory } from './categories';
import { lockedMoneyAccount, recordNewEntry, type Entry } from './entries';
import { lockedEvent } from './events';
import { entryDate } from './transactions';

/**
 * Repeating entries (docs/ledger.md): salary, rent, EMIs, SIPs, subscriptions. Each falls due on a
 * schedule (src/core/schedule.ts) and is either recorded automatically or waits for the user to
 * confirm it, with the amount, or skip it. Due entries are processed when the user opens FinDB
 * (runDue), so no scheduled job is needed. Each due date is recorded at most once: entries keep the
 * repeating entry and the date (a unique index), so two pages opening at once cannot double it.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;
type Kind = 'income' | 'expense' | 'transfer';
type Mode = 'auto' | 'confirm';

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
/** The most occurrences one repeating entry may catch up on at a time */
const CATCH_UP_LIMIT = 62;

export interface Repeating {
    id: number;
    type: Kind;
    description: string;
    amount: string;
    account: { id: number; name: string };
    toAccount: { id: number; name: string } | null;
    category: { id: number; name: string } | null;
    event: { id: number; name: string } | null;
    tags: string[];
    frequency: Frequency;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    month: number | null;
    startsOn: string;
    endsOn: string | null;
    /** The next date it falls due; null once it has ended */
    nextDue: string | null;
    mode: Mode;
    remindDays: number;
    paused: boolean;
}

export interface DueItem {
    recurringId: number;
    type: Kind;
    description: string;
    amount: string;
    date: string;
    account: string;
    mode: Mode;
}

/** Today in India, where FinDB's users are, as YYYY-MM-DD */
export function todayInIndia(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const SELECT = `
    SELECT r.*, r.starts_on::text AS starts_text, r.ends_on::text AS ends_text, r.next_due::text AS next_text,
           a.name AS account_name, t.name AS to_account_name, c.name AS category_name, ev.name AS event_name
    FROM recurring_entries r
    JOIN ledger_accounts a ON a.user_id = r.user_id AND a.id = r.account_id
    LEFT JOIN ledger_accounts t ON t.user_id = r.user_id AND t.id = r.to_account_id
    LEFT JOIN ledger_accounts c ON c.user_id = r.user_id AND c.id = r.category_id
    LEFT JOIN events ev ON ev.user_id = r.user_id AND ev.id = r.event_id
    WHERE r.user_id = $1`;

function toRepeating(row: Record<string, unknown>): Repeating {
    const ref = (id: unknown, name: unknown) => (id === null || id === undefined ? null : { id: Number(id), name: String(name) });
    return {
        id: Number(row.id),
        type: row.entry_type as Kind,
        description: String(row.description),
        amount: fromPaise(Number(row.amount_paise)),
        account: ref(row.account_id, row.account_name)!,
        toAccount: ref(row.to_account_id, row.to_account_name),
        category: ref(row.category_id, row.category_name),
        event: ref(row.event_id, row.event_name),
        tags: (row.tags as string[]) ?? [],
        frequency: row.frequency as Frequency,
        dayOfWeek: row.day_of_week === null ? null : Number(row.day_of_week),
        dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
        month: row.month === null ? null : Number(row.month),
        startsOn: String(row.starts_text),
        endsOn: (row.ends_text as string | null) ?? null,
        nextDue: (row.next_text as string | null) ?? null,
        mode: row.mode as Mode,
        remindDays: Number(row.remind_days),
        paused: row.paused_at !== null,
    };
}

const ruleOf = (item: Pick<Repeating, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'month'>): Rule =>
    ({ frequency: item.frequency, dayOfWeek: item.dayOfWeek, dayOfMonth: item.dayOfMonth, month: item.month });

/** The next due date from a start, or null when that is past the end */
function firstDue(rule: Rule, from: string, endsOn: string | null): string | null {
    const next = nextOnOrAfter(rule, from);
    return endsOn !== null && next > endsOn ? null : next;
}

export async function listRepeating(pool: Pool, userId: number): Promise<Repeating[]> {
    const result = await pool.query(`${SELECT} ORDER BY r.next_due NULLS LAST, lower(r.description)`, [userId]);
    return result.rows.map(toRepeating);
}

async function lockedRepeating(client: Client, userId: number, id: unknown): Promise<Repeating> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, 'Repeating entry not found');
    await client.query('SELECT id FROM recurring_entries WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
    const result = await client.query(`${SELECT} AND r.id = $2`, [userId, id]);
    if (!result.rows[0]) throw new RequestError(404, 'Repeating entry not found');
    return toRepeating(result.rows[0]);
}

interface Input {
    type: Kind; description: string; paise: number; accountId: number; toAccountId: number | null; categoryId: number | null;
    eventId: number | null; tags: string[]; rule: Rule; startsOn: string; endsOn: string | null; mode: Mode; remindDays: number;
}

const optionalInt = (value: unknown) => (value === undefined || value === null || value === '' ? null : Number(value));

/** Read and check a repeating entry, filling in what an edit leaves out from the current one */
async function readRepeating(client: Client, userId: number, body: Body, current?: Repeating): Promise<Input> {
    const has = (key: string) => body[key] !== undefined;
    const type = (has('type') ? body.type : current?.type) as Kind;
    if (!['income', 'expense', 'transfer'].includes(type)) throw new RequestError(400, 'Type must be income, expense or transfer');
    const descriptionValue = has('description') ? body.description : current?.description;
    if (typeof descriptionValue !== 'string' || !descriptionValue.trim()) throw new RequestError(400, 'Description is required');
    const description = descriptionValue.trim();
    if (description.length > 200) throw new RequestError(400, 'Description is too long (max 200 characters)');

    let paise: number;
    try {
        paise = has('amount') ? toPaise(body.amount) : toPaise(current?.amount);
    } catch {
        throw new RequestError(400, 'Enter a valid amount');
    }
    if (paise <= 0) throw new RequestError(400, 'Enter an amount greater than zero');

    const account = await lockedMoneyAccount(client, userId, has('accountId') ? body.accountId : current?.account.id);
    let toAccountId: number | null = null;
    if (type === 'transfer') {
        const to = await lockedMoneyAccount(client, userId, has('toAccountId') ? body.toAccountId : current?.toAccount?.id, 'Destination account');
        if (to.id === account.id) throw new RequestError(400, 'Choose two different accounts for a transfer');
        toAccountId = to.id;
    } else if (type === 'income' && account.type === 'credit_card') {
        throw new RequestError(400, 'Income goes into a bank, cash, a wallet or a meal card');
    }
    const categoryValue = has('categoryId') ? body.categoryId : current?.category?.id;
    const categoryId = type === 'transfer' || categoryValue === undefined || categoryValue === null || categoryValue === ''
        ? null : (await lockedCategory(client, userId, categoryValue, type)).id;
    const eventValue = has('eventId') ? body.eventId : current?.event?.id;
    const eventId = eventValue === undefined || eventValue === null || eventValue === ''
        ? null : has('eventId') ? (await lockedEvent(client, userId, eventValue)).id : Number(eventValue);

    const tagsValue = has('tags') ? body.tags : current?.tags ?? [];
    const tags = (Array.isArray(tagsValue) ? tagsValue : typeof tagsValue === 'string' ? tagsValue.split(',') : [])
        .map(tag => String(tag).trim()).filter(Boolean);
    if (tags.length > 10 || tags.some(tag => tag.length > 30)) throw new RequestError(400, 'At most 10 tags of up to 30 characters');

    const frequency = (has('frequency') ? body.frequency : current?.frequency) as Frequency;
    if (!FREQUENCIES.includes(frequency)) throw new RequestError(400, 'Repeat daily, weekly, monthly or yearly');
    const rule: Rule = {
        frequency,
        dayOfWeek: frequency === 'weekly' ? optionalInt(has('dayOfWeek') ? body.dayOfWeek : current?.dayOfWeek) : null,
        dayOfMonth: frequency === 'monthly' || frequency === 'yearly' ? optionalInt(has('dayOfMonth') ? body.dayOfMonth : current?.dayOfMonth) : null,
        month: frequency === 'yearly' ? optionalInt(has('month') ? body.month : current?.month) : null,
    };
    const problem = ruleProblem(rule);
    if (problem) throw new RequestError(400, problem);

    const starts = entryDate(has('startsOn') ? body.startsOn : current?.startsOn);
    if (!starts) throw new RequestError(400, 'Start date is required');
    const endsValue = has('endsOn') ? body.endsOn : current?.endsOn;
    const ends = endsValue === undefined || endsValue === null || endsValue === '' ? null : entryDate(endsValue);
    if (endsValue && !ends) throw new RequestError(400, 'End date is not a valid date');
    if (ends && ends.date < starts.date) throw new RequestError(400, 'The end date is before the start date');

    const mode = (has('mode') ? body.mode : current?.mode ?? 'confirm') as Mode;
    if (mode !== 'auto' && mode !== 'confirm') throw new RequestError(400, 'Mode must be auto or confirm');
    const remindDays = Number(has('remindDays') ? body.remindDays : current?.remindDays ?? 3);
    if (!Number.isInteger(remindDays) || remindDays < 0 || remindDays > 30) throw new RequestError(400, 'Remind 0 to 30 days before');

    return {
        type, description, paise, accountId: account.id, toAccountId, categoryId, eventId, tags, rule,
        startsOn: starts.date, endsOn: ends ? ends.date : null, mode, remindDays,
    };
}

const COLUMNS = `entry_type, description, amount_paise, account_id, to_account_id, category_id, event_id, tags,
    frequency, day_of_week, day_of_month, month, starts_on, ends_on, next_due, mode, remind_days`;
const values = (input: Input, nextDue: string | null) => [
    input.type, input.description, input.paise, input.accountId, input.toAccountId, input.categoryId, input.eventId, input.tags,
    input.rule.frequency, input.rule.dayOfWeek ?? null, input.rule.dayOfMonth ?? null, input.rule.month ?? null,
    input.startsOn, input.endsOn, nextDue, input.mode, input.remindDays,
];

export async function createRepeating(pool: Pool, userId: number, body: Body): Promise<Repeating> {
    return withTransaction(pool, async (client) => {
        const input = await readRepeating(client, userId, body);
        const created = await client.query(
            `INSERT INTO recurring_entries (user_id, ${COLUMNS}) VALUES ($1, ${values(input, null).map((_, index) => `$${index + 2}`).join(', ')}) RETURNING id`,
            [userId, ...values(input, firstDue(input.rule, input.startsOn, input.endsOn))]);
        const id = Number(created.rows[0].id);
        await logActivity(client, userId, 'created', 'repeating', id, `Added repeating ${input.type}: ${input.description}`, fromPaise(input.paise));
        return lockedRepeating(client, userId, id);
    });
}

/**
 * Change a repeating entry; any field left out stays. Entries already recorded stay as they are.
 * Its next due date is worked out again from today, or from the start if that is later, so a
 * change of day takes effect from the next occurrence; { paused } pauses or resumes it.
 */
export async function updateRepeating(pool: Pool, userId: number, id: string, body: Body): Promise<Repeating> {
    return withTransaction(pool, async (client) => {
        const current = await lockedRepeating(client, userId, id);
        const input = await readRepeating(client, userId, body, current);
        const today = todayInIndia();
        // Due dates already passed and not yet recorded are kept: from the current next due date if earlier
        const from = [input.startsOn, current.nextDue && current.nextDue < today ? current.nextDue : today].sort().at(-1)!;
        const nextDue = firstDue(input.rule, from, input.endsOn);
        await client.query(
            `UPDATE recurring_entries SET (${COLUMNS}) = (${values(input, nextDue).map((_, index) => `$${index + 3}`).join(', ')})
             WHERE id = $1 AND user_id = $2`,
            [id, userId, ...values(input, nextDue)]);
        if (body.paused !== undefined) {
            if (typeof body.paused !== 'boolean') throw new RequestError(400, 'Paused must be true or false');
            await client.query('UPDATE recurring_entries SET paused_at = CASE WHEN $3 THEN now() END WHERE id = $1 AND user_id = $2', [id, userId, body.paused]);
        }
        await logActivity(client, userId, 'updated', 'repeating', Number(id), `Updated repeating ${input.type}: ${input.description}`, fromPaise(input.paise));
        return lockedRepeating(client, userId, id);
    });
}

/** Delete a repeating entry; the entries it already made stay */
export async function deleteRepeating(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const current = await lockedRepeating(client, userId, id);
        await client.query('DELETE FROM recurring_entries WHERE id = $1 AND user_id = $2', [current.id, userId]);
        await logActivity(client, userId, 'deleted', 'repeating', current.id, `Deleted repeating ${current.type}: ${current.description}`, current.amount);
    });
}

const entryBody = (item: Repeating, date: string, amount?: unknown) => ({
    type: item.type, date, description: item.description, amount: amount ?? item.amount, accountId: item.account.id,
    toAccountId: item.toAccount?.id, categoryId: item.category?.id, tags: item.tags, eventId: item.event?.id ?? null,
});

/** Record one occurrence, unless it already is; returns false when it was already there */
async function recordOccurrence(client: Client, userId: number, item: Repeating, date: string, checkSpending: boolean, amount?: unknown): Promise<boolean> {
    const done = await client.query(
        'SELECT 1 FROM journal_entries WHERE recurring_id = $1 AND recurring_on = $2 AND voided_at IS NULL AND user_id = $3', [item.id, date, userId]);
    if (done.rows.length > 0) return false;
    await recordNewEntry(client, userId, entryBody(item, date, amount), { checkSpending, recurring: { id: item.id, on: date } });
    return true;
}

async function advance(client: Client, userId: number, item: Repeating, after: string): Promise<void> {
    const next = nextAfter(ruleOf(item), after);
    await client.query('UPDATE recurring_entries SET next_due = $1 WHERE id = $2 AND user_id = $3',
        [item.endsOn !== null && next > item.endsOn ? null : next, item.id, userId]);
}

/** What is due now and soon, for the user to see: confirm-mode entries due, and any due within their reminder days */
async function dueItems(client: Client, userId: number, today: string): Promise<{ pending: DueItem[]; upcoming: DueItem[] }> {
    const active = (await client.query(`${SELECT} AND r.next_due IS NOT NULL AND r.paused_at IS NULL ORDER BY r.next_due, r.id`, [userId])).rows.map(toRepeating);
    const pending: DueItem[] = [];
    const upcoming: DueItem[] = [];
    for (const item of active) {
        const base = { recurringId: item.id, type: item.type, description: item.description, amount: item.amount, account: item.account.name, mode: item.mode };
        if (item.mode === 'confirm') {
            for (const date of occurrences(ruleOf(item), item.nextDue!, today, item.endsOn, 12)) pending.push({ ...base, date });
        }
        const next = item.nextDue! > today ? item.nextDue! : nextOnOrAfter(ruleOf(item), addDays(today, 1));
        if (next <= addDays(today, item.remindDays) && (item.endsOn === null || next <= item.endsOn)) upcoming.push({ ...base, date: next });
    }
    return { pending, upcoming };
}

/**
 * Record every automatic repeating entry that has fallen due (catching up on days FinDB was not
 * opened, up to a limit), and return what waits for the user and what is due soon. One that cannot
 * be recorded (its account was removed, say) is left as it is and reported.
 */
export async function runDue(pool: Pool, userId: number, today = todayInIndia())
    : Promise<{ posted: number; problems: { recurringId: number; description: string; error: string }[]; pending: DueItem[]; upcoming: DueItem[] }> {
    const due = await pool.query(
        'SELECT id FROM recurring_entries WHERE user_id = $1 AND mode = \'auto\' AND paused_at IS NULL AND next_due <= $2 ORDER BY next_due, id',
        [userId, today]);
    let posted = 0;
    const problems: { recurringId: number; description: string; error: string }[] = [];
    for (const { id } of due.rows) {
        try {
            // One transaction (a savepoint within the request) per repeating entry: a problem with one
            // leaves the others recorded. The row lock makes a second page opening at once wait, then
            // find nothing left to do.
            await withTransaction(pool, async (client) => {
                // Another page processing it right now: leave it to that one
                const free = await client.query('SELECT id FROM recurring_entries WHERE id = $1 AND user_id = $2 FOR UPDATE SKIP LOCKED', [id, userId]);
                if (free.rows.length === 0) return;
                const item = await lockedRepeating(client, userId, id);
                if (!item.nextDue || item.nextDue > today || item.paused || item.mode !== 'auto') return;
                const dates = occurrences(ruleOf(item), item.nextDue, today, item.endsOn, CATCH_UP_LIMIT);
                for (const date of dates) if (await recordOccurrence(client, userId, item, date, false)) posted++;
                await advance(client, userId, item, dates.at(-1)!);
            });
        } catch (error) {
            if (!(error instanceof RequestError)) throw error;
            problems.push({ recurringId: Number(id), description: '', error: error.message });
        }
    }
    for (const problem of problems) {
        const item = (await pool.query('SELECT description FROM recurring_entries WHERE id = $1 AND user_id = $2', [problem.recurringId, userId])).rows[0];
        problem.description = item?.description ?? '';
    }
    return { posted, problems, ...(await dueItems(pool, userId, today)) };
}

/**
 * Record the next due occurrence of a repeating entry now, with its amount or another one (a
 * varying bill), as a new entry would be: the spending check applies. Returns the entry recorded,
 * or null when that date was already recorded.
 */
export async function confirmDue(pool: Pool, userId: number, id: string, body: Body): Promise<{ entry: Entry | null; repeating: Repeating }> {
    return withTransaction(pool, async (client) => {
        const item = await lockedRepeating(client, userId, id);
        if (!item.nextDue || item.paused) throw new RequestError(400, 'Nothing is due for this repeating entry');
        if (body.date !== undefined && body.date !== item.nextDue) throw new RequestError(400, `The next date due is ${item.nextDue}`);
        const done = await client.query(
            'SELECT 1 FROM journal_entries WHERE recurring_id = $1 AND recurring_on = $2 AND voided_at IS NULL AND user_id = $3', [item.id, item.nextDue, userId]);
        const entry = done.rows.length > 0 ? null
            : await recordNewEntry(client, userId, entryBody(item, item.nextDue, body.amount), { checkSpending: true, recurring: { id: item.id, on: item.nextDue } });
        await advance(client, userId, item, item.nextDue);
        return { entry, repeating: await lockedRepeating(client, userId, id) };
    });
}

/** Skip the next due occurrence without recording it */
export async function skipDue(pool: Pool, userId: number, id: string, body: Body): Promise<Repeating> {
    return withTransaction(pool, async (client) => {
        const item = await lockedRepeating(client, userId, id);
        if (!item.nextDue) throw new RequestError(400, 'Nothing is due for this repeating entry');
        if (body.date !== undefined && body.date !== item.nextDue) throw new RequestError(400, `The next date due is ${item.nextDue}`);
        await advance(client, userId, item, item.nextDue);
        await logActivity(client, userId, 'updated', 'repeating', item.id, `Skipped ${item.description} due ${item.nextDue}`, null);
        return lockedRepeating(client, userId, id);
    });
}

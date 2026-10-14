import type { Pool } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { entriesByIds, type Entry } from './entries';
import { entryDate } from './transactions';

/**
 * Search across everything (v2 Phase 2): entries by words (in the description, category, accounts,
 * tags and event), amount, date range, type, account, category, tag and event, with the totals of
 * every match; and the accounts, categories and events whose names match the words, to filter by.
 * Saved searches keep the filters under a name. Documents join the search with the vault; people
 * and assets with their phases.
 */

type Body = Record<string, unknown>;

export interface Filters {
    q?: string;
    from?: string;
    to?: string;
    /** Rupees text */
    min?: string;
    max?: string;
    type?: 'income' | 'expense' | 'transfer';
    accountId?: number;
    categoryId?: number;
    tag?: string;
    eventId?: number;
}

const FILTER_KEYS = ['q', 'from', 'to', 'min', 'max', 'type', 'accountId', 'categoryId', 'tag', 'eventId'] as const;
const TYPES = ['income', 'expense', 'transfer'];
const PAGE = 50;
const MAX_SAVED = 20;

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());

/** The filters from a query string or a saved search, checked; empty ones left out */
export function readFilters(source: Record<string, unknown>): Filters {
    const filters: Filters = {};
    const q = text(source.q);
    if (q.length > 100) throw new RequestError(400, t('errors.search.tooLong'));
    if (q) filters.q = q;
    for (const key of ['from', 'to'] as const) {
        const value = text(source[key]);
        if (!value) continue;
        const date = entryDate(value);
        if (!date) throw new RequestError(400, t('errors.search.badDate'));
        filters[key] = date.date;
    }
    for (const key of ['min', 'max'] as const) {
        const value = text(source[key]);
        if (!value) continue;
        let paise: number;
        try {
            paise = toPaise(value);
        } catch {
            throw new RequestError(400, t('errors.search.badAmount'));
        }
        if (paise < 0) throw new RequestError(400, t('errors.search.badAmount'));
        filters[key] = fromPaise(paise);
    }
    const type = text(source.type);
    if (type) {
        if (!TYPES.includes(type)) throw new RequestError(400, t('errors.typeMustIncomeExpenseTransfer'));
        filters.type = type as Filters['type'];
    }
    for (const key of ['accountId', 'categoryId', 'eventId'] as const) {
        const value = text(source[key]);
        if (!value) continue;
        if (!/^\d+$/.test(value)) throw new RequestError(400, t('errors.search.badFilter'));
        filters[key] = Number(value);
    }
    const tag = text(source.tag);
    if (tag.length > 30) throw new RequestError(400, t('errors.tagTooLong'));
    if (tag) filters.tag = tag;
    return filters;
}

/** A word for ILIKE, with its wildcards taken literally */
const like = (word: string) => `%${word.replace(/[\\%_]/g, match => `\\${match}`)}%`;

/** A word that reads as an amount ("450", "1,200.50", "₹99"), as paise; null otherwise */
function amountWord(word: string): number | null {
    const cleaned = word.replace(/₹|,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    try {
        return toPaise(cleaned);
    } catch {
        return null;
    }
}

export interface SearchResult {
    filters: Filters;
    entries: Entry[];
    /** Every match, not only this page */
    total: number;
    totals: { income: string; expense: string; transfer: string };
    offset: number;
    more: boolean;
    /** Names matching the words, to filter by (first page only) */
    accounts: { id: number; name: string; type: string }[];
    categories: { id: number; name: string; kind: string }[];
    events: { id: number; name: string }[];
}

export async function search(pool: Pool, userId: number, source: Record<string, unknown>): Promise<SearchResult> {
    const filters = readFilters(source);
    const offset = Math.max(Number.parseInt(text(source.offset) || '0', 10) || 0, 0);
    const params: unknown[] = [userId];
    const add = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
    };
    const where: string[] = [];
    if (filters.from) where.push(`m.entry_date >= ${add(filters.from)}::date`);
    if (filters.to) where.push(`m.entry_date <= ${add(filters.to)}::date`);
    if (filters.type) where.push(`m.entry_type = ${add(filters.type)}`);
    if (filters.min) where.push(`m.paise >= ${add(toPaise(filters.min))}`);
    if (filters.max) where.push(`m.paise <= ${add(toPaise(filters.max))}`);
    if (filters.eventId) where.push(`m.event_id = ${add(filters.eventId)}`);
    for (const id of [filters.accountId, filters.categoryId]) {
        if (id) where.push(`EXISTS (SELECT 1 FROM journal_lines l WHERE l.user_id = $1 AND l.entry_id = m.id AND l.account_id = ${add(id)})`);
    }
    if (filters.tag) {
        where.push(`EXISTS (SELECT 1 FROM entry_tags et JOIN tags tg ON tg.user_id = et.user_id AND tg.id = et.tag_id
            WHERE et.user_id = $1 AND et.entry_id = m.id AND lower(tg.name) = lower(${add(filters.tag)}))`);
    }
    // Every word must appear somewhere in the entry, or be its amount
    for (const word of (filters.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8)) {
        const paise = amountWord(word);
        where.push(`(m.haystack ILIKE ${add(like(word))}${paise !== null ? ` OR m.paise = ${add(paise)}` : ''})`);
    }

    const matched = `
        WITH m AS (
            SELECT e.id, e.entry_date, e.entry_type, e.event_id,
                   (SELECT max(abs(l.amount_paise)) FROM journal_lines l WHERE l.user_id = e.user_id AND l.entry_id = e.id) AS paise,
                   concat_ws(' ', e.description, ev.name,
                       (SELECT string_agg(a.name, ' ') FROM journal_lines l JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
                        WHERE l.user_id = e.user_id AND l.entry_id = e.id),
                       (SELECT string_agg(tg.name, ' ') FROM entry_tags et JOIN tags tg ON tg.user_id = et.user_id AND tg.id = et.tag_id
                        WHERE et.user_id = e.user_id AND et.entry_id = e.id)) AS haystack
            FROM journal_entries e LEFT JOIN events ev ON ev.user_id = e.user_id AND ev.id = e.event_id
            WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type IN ('income', 'expense', 'transfer')
        )
        SELECT m.id, m.entry_type, m.paise, count(*) OVER () AS total,
               sum(m.paise) FILTER (WHERE m.entry_type = 'income') OVER () AS income,
               sum(m.paise) FILTER (WHERE m.entry_type = 'expense') OVER () AS expense,
               sum(m.paise) FILTER (WHERE m.entry_type = 'transfer') OVER () AS transfer
        FROM m ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.entry_date DESC, m.id DESC
        LIMIT ${PAGE + 1} OFFSET ${add(offset)}`;
    const rows = (await pool.query(matched, params)).rows;
    const page = rows.slice(0, PAGE);
    const first = rows[0];
    let total = first ? Number(first.total) : 0;
    let sums = { income: Number(first?.income ?? 0), expense: Number(first?.expense ?? 0), transfer: Number(first?.transfer ?? 0) };
    if (!first && offset > 0) {
        // Past the end: the totals still describe the whole search
        const again = await search(pool, userId, { ...source, offset: 0 });
        total = again.total;
        sums = { income: toPaise(again.totals.income), expense: toPaise(again.totals.expense), transfer: toPaise(again.totals.transfer) };
    }

    const names = offset === 0 && filters.q ? await matchingNames(pool, userId, filters.q) : { accounts: [], categories: [], events: [] };
    return {
        filters,
        entries: await entriesByIds(pool, userId, page.map(row => Number(row.id))),
        total,
        totals: { income: fromPaise(sums.income), expense: fromPaise(sums.expense), transfer: fromPaise(sums.transfer) },
        offset,
        more: rows.length > PAGE,
        ...names,
    };
}

/** Accounts, categories and events whose names hold every word */
async function matchingNames(pool: Pool, userId: number, q: string) {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 8).map(like);
    const result = await pool.query(
        `SELECT 'account' AS what, id, name, subtype AS kind FROM ledger_accounts
         WHERE user_id = $1 AND archived_at IS NULL AND subtype IN ('bank', 'cash', 'credit_card', 'wallet', 'meal_card')
           AND (SELECT bool_and(concat_ws(' ', name, institution) ILIKE w) FROM unnest($2::text[]) AS w)
         UNION ALL
         SELECT 'category', id, name, kind FROM ledger_accounts
         WHERE user_id = $1 AND archived_at IS NULL AND kind IN ('income', 'expense')
           AND (SELECT bool_and(name ILIKE w) FROM unnest($2::text[]) AS w)
         UNION ALL
         SELECT 'event', id, name, NULL FROM events
         WHERE user_id = $1 AND archived_at IS NULL AND (SELECT bool_and(name ILIKE w) FROM unnest($2::text[]) AS w)
         ORDER BY 1, 3 LIMIT 30`,
        [userId, words]);
    const of = (what: string) => result.rows.filter(row => row.what === what);
    return {
        accounts: of('account').map(row => ({ id: Number(row.id), name: row.name, type: row.kind })),
        categories: of('category').map(row => ({ id: Number(row.id), name: row.name, kind: row.kind })),
        events: of('event').map(row => ({ id: Number(row.id), name: row.name })),
    };
}

// ----- Saved searches -----

export interface SavedSearch { id: number; name: string; filters: Filters }

export async function listSavedSearches(pool: Pool, userId: number): Promise<SavedSearch[]> {
    const result = await pool.query('SELECT id, name, filters FROM saved_searches WHERE user_id = $1 ORDER BY lower(name)', [userId]);
    return result.rows.map(row => ({ id: Number(row.id), name: row.name, filters: row.filters as Filters }));
}

/** { name, filters }: keep a search under a name; the same name replaces it */
export async function saveSearch(pool: Pool, userId: number, body: Body): Promise<SavedSearch> {
    const name = text(body.name);
    if (!name) throw new RequestError(400, t('errors.search.nameRequired'));
    if (name.length > 60) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 60 }));
    const raw = (body.filters && typeof body.filters === 'object' ? body.filters : {}) as Record<string, unknown>;
    const filters = readFilters(Object.fromEntries(FILTER_KEYS.map(key => [key, raw[key]])));
    if (Object.keys(filters).length === 0) throw new RequestError(400, t('errors.search.nothingToSave'));
    return withTransaction(pool, async (client) => {
        const count = await client.query('SELECT count(*)::int AS n FROM saved_searches WHERE user_id = $1 AND lower(name) <> lower($2)', [userId, name]);
        if (count.rows[0].n >= MAX_SAVED) throw new RequestError(400, t('errors.search.tooMany', { max: MAX_SAVED }));
        const saved = await client.query(
            `INSERT INTO saved_searches (user_id, name, filters) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, lower(name)) DO UPDATE SET filters = excluded.filters, name = excluded.name
             RETURNING id, name, filters`,
            [userId, name, JSON.stringify(filters)]);
        const row = saved.rows[0];
        await logActivity(client, userId, 'created', 'search', Number(row.id), `Saved search: ${name}`, null, null, { name, filters });
        return { id: Number(row.id), name: row.name, filters: row.filters as Filters };
    });
}

export async function deleteSavedSearch(pool: Pool, userId: number, id: string): Promise<void> {
    if (!/^\d+$/.test(id)) throw new RequestError(404, t('errors.search.notFound'));
    await withTransaction(pool, async (client) => {
        const removed = await client.query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING name', [id, userId]);
        if (removed.rows.length === 0) throw new RequestError(404, t('errors.search.notFound'));
        await logActivity(client, userId, 'deleted', 'search', Number(id), `Removed saved search: ${removed.rows[0].name}`, null, { name: removed.rows[0].name }, null);
    });
}

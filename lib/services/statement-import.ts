import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { suggestByKeyword, titleWords } from '../categories';
import { fromPaise, systemAccount, toPaise } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { MAPPING_FIELDS, MAX_IMPORT_ROWS, mappingProblem, transferHint, type Mapping, type TransferHint } from '../../src/core/statement';
import { ensureCategories, lockedCategory } from './categories';
import { CARD_INCOME_KEYS, listAccounts, lockedMoneyAccount, type MoneyAccount } from './entries';
import { entryDate } from './transactions';
import { todayInIndia } from './recurring';

/**
 * Statement import (v2 Phase 2, docs/ledger.md): bank and card statements into the ledger.
 *
 * The browser reads the CSV, Excel or PDF file (src/core/statement.ts), so the file never reaches FinDB.
 * It sends the rows for a review (previewImport), which flags for each row:
 *   - a duplicate: an entry already on the account with the same amount within three days (an
 *     earlier import of the same statement, or one entered by hand);
 *   - a transfer between the user's own accounts: an ATM withdrawal (to cash), a card bill payment
 *     (between the bank and the card), or the other side of an entry already recorded on another
 *     account as income or spending (which the import replaces with one transfer);
 *   - a category, from the user's own past choices and then by keyword (lib/categories.ts).
 * The rows the user keeps are saved together (commitImport) as one import, which can be undone.
 * The overspending check is skipped: the bank already allowed these payments.
 */

type Body = Record<string, unknown>;
type Client = Pick<PoolClient, 'query'>;

/** How far apart (days) a statement's date and an entry's may be and still be the same payment */
const MATCH_DAYS = 3;
const MONEY_TYPES = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];

/** What to record a row as: income or spending in a category, a transfer, or the other side of an existing entry */
export type ImportAction =
    | { type: 'category'; categoryId: number | null }
    | { type: 'transfer'; accountId: number }
    | { type: 'replace'; entryId: number };

interface Row {
    line: number;
    date: string;
    description: string;
    narration: string;
    /** Into the account positive, out negative */
    paise: number;
}

// ----- Reading the request -----

function rowProblem(line: number, problem: string): RequestError {
    return new RequestError(400, t('errors.import.row', { line, problem }));
}

function readRows(value: unknown): Row[] {
    if (!Array.isArray(value) || value.length === 0) throw new RequestError(400, t('errors.import.noRows'));
    if (value.length > MAX_IMPORT_ROWS) throw new RequestError(400, t('errors.import.tooManyRows', { max: MAX_IMPORT_ROWS }));
    const today = todayInIndia();
    return value.map((item, index) => {
        const raw = (item && typeof item === 'object' ? item : {}) as Body;
        const line = Number.isInteger(raw.line) && Number(raw.line) > 0 ? Number(raw.line) : index + 1;
        const date = entryDate(raw.date)?.date;
        if (!date || date < '1900-01-01') throw rowProblem(line, t('errors.import.badDate'));
        if (date > today) throw rowProblem(line, t('errors.import.futureDate'));
        const description = typeof raw.description === 'string' ? raw.description.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (!description) throw rowProblem(line, t('errors.import.noDescription'));
        const narration = typeof raw.narration === 'string' ? raw.narration.slice(0, 500) : description;
        let paise: number;
        try {
            paise = toPaise(raw.amount);
        } catch {
            throw rowProblem(line, t('errors.import.badAmount'));
        }
        if (paise === 0) throw rowProblem(line, t('errors.import.badAmount'));
        return { line, date, description, narration, paise };
    });
}

/** The account a statement is for: one of the user's money accounts */
function findAccount(accounts: MoneyAccount[], id: unknown): MoneyAccount {
    const account = accounts.find(item => String(item.id) === String(id ?? ''));
    if (!account) throw new RequestError(400, t('errors.fieldNotFound', { field: t('errors.fields.account') }));
    return account;
}

const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function dateRange(rows: Row[]): { from: string; to: string } {
    const dates = rows.map(row => row.date).sort();
    return { from: dates[0]!, to: dates[dates.length - 1]! };
}

// ----- Review -----

interface Existing { id: number; date: string; description: string; paise: number }

/** Entries already on the account around the statement's dates (their line on this account) */
async function existingOnAccount(client: Client, userId: number, accountId: number, from: string, to: string): Promise<Existing[]> {
    const result = await client.query(
        `SELECT e.id, e.entry_date::text AS date, e.description, l.amount_paise
         FROM journal_entries e JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         WHERE e.user_id = $1 AND l.account_id = $2 AND e.voided_at IS NULL AND e.entry_type <> 'opening_balance'
           AND e.entry_date BETWEEN $3::date AND $4::date
         ORDER BY e.entry_date, e.id`,
        [userId, accountId, shiftDate(from, -MATCH_DAYS), shiftDate(to, MATCH_DAYS)]);
    return result.rows.map(row => ({ id: Number(row.id), date: row.date, description: row.description, paise: Number(row.amount_paise) }));
}

interface Counterpart {
    id: number; date: string; description: string; type: 'income' | 'expense';
    accountId: number; accountName: string; paise: number; categoryName: string; fallback: boolean; imported: boolean;
}

/**
 * Income and spending on the user's other money accounts around the statement's dates that could be
 * the other side of a transfer: two lines (the money account and a category), recorded in the ledger
 * (not through the former routes), not part of a reimbursement, and not on a reconciled statement.
 */
async function counterparts(client: Client, userId: number, accountId: number, from: string, to: string, entryIds?: number[]): Promise<Counterpart[]> {
    const result = await client.query(
        `SELECT e.id, e.entry_date::text AS date, e.description, e.entry_type, e.import_batch_id,
                l.account_id, l.amount_paise, a.name AS account_name, c.name AS category_name, c.system_key
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         JOIN journal_lines cl ON cl.user_id = e.user_id AND cl.entry_id = e.id AND cl.id <> l.id
         JOIN ledger_accounts c ON c.user_id = cl.user_id AND c.id = cl.account_id
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type IN ('income', 'expense')
           AND e.source_table IS NULL AND e.reimbursement_id IS NULL AND NOT e.sample
           AND a.subtype = ANY($5::text[]) AND a.archived_at IS NULL AND l.account_id <> $2
           AND c.kind IN ('income', 'expense')
           AND ($6::bigint[] IS NULL OR e.id = ANY($6::bigint[]))
           AND ($6::bigint[] IS NOT NULL OR e.entry_date BETWEEN $3::date AND $4::date)
           AND (SELECT count(*) FROM journal_lines x WHERE x.user_id = e.user_id AND x.entry_id = e.id) = 2
           AND NOT EXISTS (SELECT 1 FROM journal_lines x WHERE x.user_id = e.user_id AND x.entry_id = e.id AND x.reconciliation_id IS NOT NULL)
         ORDER BY e.entry_date, e.id`,
        [userId, accountId, shiftDate(from, -MATCH_DAYS), shiftDate(to, MATCH_DAYS), MONEY_TYPES, entryIds ?? null]);
    return result.rows.map(row => ({
        id: Number(row.id), date: row.date, description: row.description, type: row.entry_type,
        accountId: Number(row.account_id), accountName: row.account_name, paise: Number(row.amount_paise),
        categoryName: row.category_name, fallback: row.system_key !== null, imported: row.import_batch_id !== null,
    }));
}

/** Pick the closest unused entry with the same amount, within MATCH_DAYS; the same date and description first */
function closest<T extends { id: number; date: string; description: string }>(row: Row, candidates: T[], used: Set<number>): T | null {
    let best: T | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        if (used.has(candidate.id)) continue;
        const days = daysBetween(row.date, candidate.date);
        if (days > MATCH_DAYS) continue;
        const sameText = candidate.description.trim().toLowerCase() === row.description.toLowerCase();
        const score = days * 2 + (sameText ? 0 : 1);
        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    if (best) used.add(best.id);
    return best;
}

interface CategoryChoice { id: number; name: string; key: string | null; kind: 'income' | 'expense' }

/**
 * Suggests categories for many titles at once, by the same rules as suggestCategory
 * (lib/services/categories.ts): the category last used for the same title, then for a title
 * starting with the same word, then a default category by keyword.
 */
async function categorySuggester(client: Client, userId: number) {
    await ensureCategories(client, userId);
    const categories = await client.query(
        `SELECT id, kind, name, category_key FROM ledger_accounts
         WHERE user_id = $1 AND kind IN ('income', 'expense') AND system_key IS NULL AND archived_at IS NULL`, [userId]);
    const byId = new Map<number, CategoryChoice>(categories.rows.map(row => [Number(row.id),
        { id: Number(row.id), name: row.name, key: row.category_key, kind: row.kind }]));
    const byKey = new Map([...byId.values()].filter(category => category.key).map(category => [`${category.kind}:${category.key}`, category]));
    const past = await client.query(
        `SELECT lower(e.description) AS title, l.account_id
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.kind IN ('income', 'expense') AND a.system_key IS NULL AND a.archived_at IS NULL
         ORDER BY e.entry_date DESC, e.id DESC LIMIT 5000`, [userId]);
    // Most recent first, so the first seen for a title or first word is the latest choice
    const byTitle = new Map<string, CategoryChoice>();
    const byFirstWord = new Map<string, CategoryChoice>();
    for (const row of past.rows) {
        const category = byId.get(Number(row.account_id));
        if (!category) continue;
        if (!byTitle.has(`${category.kind}:${row.title}`)) byTitle.set(`${category.kind}:${row.title}`, category);
        const [first] = titleWords(row.title);
        if (first && first.length >= 3 && !byFirstWord.has(`${category.kind}:${first}`)) byFirstWord.set(`${category.kind}:${first}`, category);
    }
    return {
        byId,
        suggest(kind: 'income' | 'expense', description: string, narration: string, allowedKeys?: string[]): { category: CategoryChoice; reason: 'history' | 'keyword' } | null {
            const allowed = (category: CategoryChoice | undefined) => category && (!allowedKeys || allowedKeys.includes(category.key ?? ''));
            const same = byTitle.get(`${kind}:${description.toLowerCase()}`);
            if (allowed(same)) return { category: same!, reason: 'history' };
            const [first] = titleWords(description);
            const similar = first && first.length >= 3 ? byFirstWord.get(`${kind}:${first}`) : undefined;
            if (allowed(similar)) return { category: similar!, reason: 'history' };
            const key = suggestByKeyword(`${description} ${narration}`, kind);
            const byWord = key ? byKey.get(`${kind}:${key}`) : undefined;
            if (allowed(byWord)) return { category: byWord!, reason: 'keyword' };
            return null;
        },
    };
}

/** Words of an account's name and provider that could appear in a narration ("HDFC", "Regalia"); not generic ones */
const GENERIC_WORDS = new Set(['bank', 'card', 'credit', 'debit', 'account', 'savings', 'current', 'salary', 'the', 'and', 'ltd', 'limited', 'india']);
function accountWords(account: MoneyAccount): string[] {
    return titleWords(`${account.name} ${account.institution ?? ''}`).filter(word => word.length >= 3 && !GENERIC_WORDS.has(word));
}

/** The one account of a type the narration names, or the only one there is */
function namedOrOnly(accounts: MoneyAccount[], narration: string): MoneyAccount | null {
    if (accounts.length === 0) return null;
    const words = new Set(titleWords(narration));
    const named = accounts.filter(account => accountWords(account).some(word => words.has(word)));
    if (named.length === 1) return named[0]!;
    return accounts.length === 1 ? accounts[0]! : null;
}

/** The other account a transfer hint points to, from the account the statement is for */
function hintedAccount(hint: TransferHint | null, row: Row, account: MoneyAccount, accounts: MoneyAccount[]): MoneyAccount | null {
    const others = accounts.filter(item => item.id !== account.id);
    if (hint === 'atm' && row.paise < 0 && account.type !== 'cash') return others.find(item => item.type === 'cash') ?? null;
    if (hint === 'card_payment') {
        // From a bank: the card being paid. On a card: the bank that paid it
        if (account.type !== 'credit_card' && row.paise < 0) return namedOrOnly(others.filter(item => item.type === 'credit_card'), row.narration);
        if (account.type === 'credit_card' && row.paise > 0) return namedOrOnly(others.filter(item => item.type === 'bank'), row.narration);
    }
    return null;
}

export interface ReviewRow {
    line: number;
    date: string;
    description: string;
    amount: string;
    /** Already in FinDB: the entry it matches */
    duplicate: { entryId: number; date: string; description: string; sameDescription: boolean } | null;
    /** The same date, amount and description appear earlier in this statement (it can be real: two coffees) */
    repeated: boolean;
    /** What the review suggests recording it as */
    action: ImportAction;
    /** Why: the user's past choice, a keyword, the narration (ATM, card bill), or a matching entry */
    reason: 'history' | 'keyword' | 'atm' | 'card_payment' | 'match' | null;
    /** An entry on another account that may be the other side of this one, even when not suggested */
    match: { entryId: number; accountId: number; accountName: string; date: string; description: string; categoryName: string } | null;
}

export interface Review {
    account: { id: number; name: string; type: string; balance: string };
    rows: ReviewRow[];
    /** The balance after importing the rows that are not duplicates */
    balanceAfter: string;
}

/** { accountId, rows: [{ line, date, description, narration, amount }] }: what each row would be recorded as */
export async function previewImport(pool: Pool, userId: number, body: Body): Promise<Review> {
    const accounts = await listAccounts(pool, userId);
    const account = findAccount(accounts, body.accountId);
    const rows = readRows(body.rows);
    const { from, to } = dateRange(rows);
    const existing = await existingOnAccount(pool, userId, account.id, from, to);
    const others = await counterparts(pool, userId, account.id, from, to);
    const suggester = await categorySuggester(pool, userId);

    const usedExisting = new Set<number>();
    const usedOthers = new Set<number>();
    const seen = new Set<string>();
    let balance = toPaise(account.balance);
    const review = rows.map((row): ReviewRow => {
        const key = `${row.date}|${row.paise}|${row.description.toLowerCase()}`;
        const repeated = seen.has(key);
        seen.add(key);
        const twin = closest(row, existing.filter(entry => entry.paise === row.paise), usedExisting);
        const duplicate = twin ? {
            entryId: twin.id, date: twin.date, description: twin.description,
            sameDescription: twin.description.trim().toLowerCase() === row.description.toLowerCase(),
        } : null;
        if (!duplicate) balance += row.paise;

        const hint = transferHint(row.narration);
        const other = duplicate ? null : closest(row, others.filter(entry => entry.paise === -row.paise), usedOthers);
        const match = other ? {
            entryId: other.id, accountId: other.accountId, accountName: other.accountName, date: other.date,
            description: other.description, categoryName: other.categoryName,
        } : null;
        const base = { line: row.line, date: row.date, description: row.description, amount: fromPaise(row.paise), duplicate, repeated, match };

        // The other side already recorded: replace it with one transfer when the words or the entry
        // itself say so (a self transfer, a card bill, uncategorised, or brought in by an import)
        if (other && (hint !== null || other.fallback || other.imported)) {
            return { ...base, action: { type: 'replace', entryId: other.id }, reason: 'match' };
        }
        if (other) usedOthers.delete(other.id);
        const target = hintedAccount(hint, row, account, accounts);
        if (target) return { ...base, action: { type: 'transfer', accountId: target.id }, reason: hint as 'atm' | 'card_payment' };

        const kind = row.paise > 0 ? 'income' : 'expense';
        // Money back on a card is a refund or cashback, never earnings
        const cardCredit = account.type === 'credit_card' && kind === 'income';
        const suggestion = suggester.suggest(kind, row.description, row.narration, cardCredit ? CARD_INCOME_KEYS : undefined);
        if (suggestion) return { ...base, action: { type: 'category', categoryId: suggestion.category.id }, reason: suggestion.reason };
        if (cardCredit) {
            const refund = [...suggester.byId.values()].find(category => category.kind === 'income' && category.key === 'refund');
            return { ...base, action: { type: 'category', categoryId: refund?.id ?? null }, reason: null };
        }
        return { ...base, action: { type: 'category', categoryId: null }, reason: null };
    });
    return {
        account: { id: account.id, name: account.name, type: account.type, balance: account.balance },
        rows: review,
        balanceAfter: fromPaise(balance),
    };
}

// ----- Saving -----

function readAction(value: unknown, line: number): ImportAction {
    const action = (value && typeof value === 'object' ? value : {}) as Body;
    const id = (field: unknown) => (/^\d+$/.test(String(field ?? '')) ? Number(field) : null);
    if (action.type === 'category') {
        if (action.categoryId === null || action.categoryId === undefined || action.categoryId === '') return { type: 'category', categoryId: null };
        const categoryId = id(action.categoryId);
        if (categoryId !== null) return { type: 'category', categoryId };
    }
    if (action.type === 'transfer' && id(action.accountId) !== null) return { type: 'transfer', accountId: id(action.accountId)! };
    if (action.type === 'replace' && id(action.entryId) !== null) return { type: 'replace', entryId: id(action.entryId)! };
    throw rowProblem(line, t('errors.import.chooseAction'));
}

/** The column choice to remember, checked: column indexes, date order and sign only */
function readLayout(value: unknown): { signature: string; presetKey: string | null; mapping: Mapping } | null {
    if (value === undefined || value === null) return null;
    const layout = value as Body;
    const mapping = (layout.mapping && typeof layout.mapping === 'object' ? layout.mapping : {}) as Body;
    const signature = typeof layout.signature === 'string' ? layout.signature : '';
    const presetKey = layout.presetKey === null || layout.presetKey === undefined ? null : String(layout.presetKey);
    const clean: Record<string, unknown> = {};
    for (const field of MAPPING_FIELDS) {
        const index = mapping[field];
        clean[field] = index === null || index === undefined ? null : index;
    }
    const valid = signature.length >= 1 && signature.length <= 500 && (presetKey === null || /^[a-z_]{1,40}$/.test(presetKey))
        && ['dmy', 'mdy', 'ymd'].includes(String(mapping.dateOrder)) && ['in', 'out'].includes(String(mapping.positive))
        && MAPPING_FIELDS.every(field => clean[field] === null || Number.isInteger(clean[field]))
        && mappingProblem({ ...clean, dateOrder: mapping.dateOrder, positive: mapping.positive } as Mapping, 200) === null;
    if (!valid) throw new RequestError(400, t('errors.import.layoutInvalid'));
    return { signature, presetKey, mapping: { ...clean, dateOrder: mapping.dateOrder, positive: mapping.positive } as Mapping };
}

export interface ImportResult {
    batchId: number;
    imported: number;
    transfers: number;
    replaced: number;
    account: { id: number; name: string; balance: string };
    /** The statement's closing balance and the difference from FinDB's balance on that date, when the statement shows one */
    closing: { date: string; balance: string; findb: string; difference: string } | null;
}

/**
 * { accountId, fileKind: "csv" | "excel" | "pdf", rowsInFile, closingBalance?: { date, amount }, layout?: { signature, presetKey, mapping },
 *   rows: [{ line, date, description, amount, action }] }: record the kept rows as one import.
 */
export async function commitImport(pool: Pool, userId: number, body: Body): Promise<ImportResult> {
    const rows = readRows(body.rows);
    const actions = (body.rows as Body[]).map((row, index) => readAction(row.action, rows[index]!.line));
    const fileKind = body.fileKind;
    if (fileKind !== 'csv' && fileKind !== 'excel' && fileKind !== 'pdf') throw new RequestError(400, t('errors.import.fileKind'));
    const rowsInFile = Number.isInteger(body.rowsInFile) && Number(body.rowsInFile) >= rows.length ? Number(body.rowsInFile) : rows.length;
    const layout = readLayout(body.layout);
    const closingInput = (body.closingBalance && typeof body.closingBalance === 'object' ? body.closingBalance : null) as Body | null;
    let closing: { date: string; paise: number } | null = null;
    if (closingInput) {
        const date = entryDate(closingInput.date)?.date;
        try {
            if (date) closing = { date, paise: toPaise(closingInput.amount) };
        } catch {
            closing = null;
        }
    }
    const { from, to } = dateRange(rows);

    return withTransaction(pool, async (client) => {
        const account = await lockedMoneyAccount(client, userId, body.accountId);

        // Every account, category and replaced entry is checked (and locked) before anything is written
        const categories = new Map<number, Awaited<ReturnType<typeof lockedCategory>>>();
        const targets = new Map<number, MoneyAccount>();
        const replaceIds = actions.flatMap(action => (action.type === 'replace' ? [action.entryId] : []));
        if (replaceIds.length > 0) {
            await client.query('SELECT id FROM journal_entries WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE', [userId, replaceIds]);
        }
        const replaceable = new Map((replaceIds.length > 0 ? await counterparts(client, userId, account.id, from, to, replaceIds) : [])
            .map(entry => [entry.id, entry]));
        const replacedUsed = new Set<number>();
        const fallback = { income: await systemAccount(client, userId, 'income'), expense: await systemAccount(client, userId, 'expense') };

        const planned: { row: Row; type: 'income' | 'expense' | 'transfer'; otherAccountId: number }[] = [];
        for (const [index, row] of rows.entries()) {
            const action = actions[index]!;
            const kind = row.paise > 0 ? 'income' : 'expense';
            if (action.type === 'category') {
                let categoryId = fallback[kind];
                let key: string | null = null;
                if (action.categoryId !== null) {
                    if (!categories.has(action.categoryId)) categories.set(action.categoryId, await lockedCategory(client, userId, action.categoryId));
                    const category = categories.get(action.categoryId)!;
                    if (category.kind !== kind) {
                        throw rowProblem(row.line, kind === 'income' ? t('errors.chooseIncomeCategoryIncome') : t('errors.chooseSpendingCategoryExpense'));
                    }
                    categoryId = category.id;
                    key = category.key;
                }
                if (account.type === 'credit_card' && kind === 'income' && !CARD_INCOME_KEYS.includes(key ?? '')) {
                    throw rowProblem(row.line, t('errors.incomeGoesIntoBankCash'));
                }
                planned.push({ row, type: kind, otherAccountId: categoryId });
            } else if (action.type === 'transfer') {
                if (!targets.has(action.accountId)) {
                    targets.set(action.accountId, await lockedMoneyAccount(client, userId, action.accountId, t('errors.fields.destinationAccount')));
                }
                if (action.accountId === account.id) throw rowProblem(row.line, t('errors.chooseTwoDifferentAccountsTransfer'));
                planned.push({ row, type: 'transfer', otherAccountId: action.accountId });
            } else {
                const entry = replaceable.get(action.entryId);
                if (!entry || replacedUsed.has(entry.id) || entry.paise !== -row.paise || daysBetween(entry.date, row.date) > MATCH_DAYS) {
                    throw rowProblem(row.line, t('errors.import.replaceGone'));
                }
                replacedUsed.add(entry.id);
                planned.push({ row, type: 'transfer', otherAccountId: entry.accountId });
            }
        }

        const batch = await client.query(
            `INSERT INTO import_batches (user_id, account_id, file_kind, rows_in_file, imported, statement_from, statement_to, closing_balance_paise, replaced_entry_ids)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [userId, account.id, fileKind, rowsInFile, rows.length, from, to, closing?.paise ?? null, [...replacedUsed]]);
        const batchId = Number(batch.rows[0].id);

        if (replacedUsed.size > 0) {
            await client.query('UPDATE journal_entries SET voided_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND voided_at IS NULL',
                [userId, [...replacedUsed]]);
        }

        // All entries in one statement and all lines in another: an import can be a thousand rows
        const created = await client.query(
            `INSERT INTO journal_entries (user_id, entry_date, description, entry_type, import_batch_id)
             SELECT $1, d.entry_date, d.description, d.entry_type, $5
             FROM unnest($2::date[], $3::text[], $4::text[]) WITH ORDINALITY AS d (entry_date, description, entry_type, n)
             ORDER BY d.n
             RETURNING id`,
            [userId, planned.map(item => item.row.date), planned.map(item => item.row.description), planned.map(item => item.type), batchId]);
        // Identity values are handed out in insertion order
        const entryIds = created.rows.map(row => Number(row.id)).sort((a, b) => a - b);
        const lineEntries: number[] = [];
        const lineAccounts: number[] = [];
        const linePaise: number[] = [];
        planned.forEach((item, index) => {
            // This account moves by the statement's amount; the category or other account takes the opposite
            lineEntries.push(entryIds[index]!, entryIds[index]!);
            lineAccounts.push(account.id, item.otherAccountId);
            linePaise.push(item.row.paise, -item.row.paise);
        });
        await client.query(
            `INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise)
             SELECT $1, l.entry_id, l.account_id, l.amount_paise FROM unnest($2::bigint[], $3::bigint[], $4::bigint[]) AS l (entry_id, account_id, amount_paise)`,
            [userId, lineEntries, lineAccounts, linePaise]);

        let profileId: number | null = null;
        if (layout) {
            const profile = await client.query(
                `INSERT INTO import_profiles (user_id, signature, preset_key, mapping, account_id) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, signature) DO UPDATE SET preset_key = excluded.preset_key, mapping = excluded.mapping,
                     account_id = excluded.account_id, last_used_at = now()
                 RETURNING id`,
                [userId, layout.signature, layout.presetKey, JSON.stringify(layout.mapping), account.id]);
            profileId = Number(profile.rows[0].id);
            await client.query('UPDATE import_batches SET profile_id = $1 WHERE id = $2 AND user_id = $3', [profileId, batchId, userId]);
        }

        const transfers = planned.filter(item => item.type === 'transfer').length;
        await logActivity(client, userId, 'created', 'import', batchId, `Imported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} into ${account.name}`,
            null, null, { accountName: account.name, entries: rows.length, transfers, replaced: replacedUsed.size, from, to, fileKind });

        const balance = await client.query(
            `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS total,
                    COALESCE(SUM(l.amount_paise) FILTER (WHERE e.entry_date <= $3::date), 0)::bigint AS on_date
             FROM journal_lines l JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
             WHERE l.user_id = $1 AND l.account_id = $2 AND e.voided_at IS NULL`,
            [userId, account.id, closing?.date ?? to]);
        const onDate = Number(balance.rows[0].on_date);
        return {
            batchId, imported: rows.length, transfers, replaced: replacedUsed.size,
            account: { id: account.id, name: account.name, balance: fromPaise(balance.rows[0].total) },
            closing: closing ? { date: closing.date, balance: fromPaise(closing.paise), findb: fromPaise(onDate), difference: fromPaise(closing.paise - onDate) } : null,
        };
    });
}

// ----- Earlier imports -----

export interface ImportBatch {
    id: number;
    account: { id: number; name: string };
    fileKind: string;
    rowsInFile: number;
    imported: number;
    /** The import's entries that still count (edited ones included; deleted ones not) */
    active: number;
    from: string | null;
    to: string | null;
    closingBalance: string | null;
    createdAt: string;
    undoneAt: string | null;
}

/** The user's imports, newest first (the last 50) */
export async function listImports(pool: Pool, userId: number): Promise<ImportBatch[]> {
    const result = await pool.query(
        `SELECT b.id, b.account_id, a.name AS account_name, b.file_kind, b.rows_in_file, b.imported, b.statement_from::text AS statement_from,
                b.statement_to::text AS statement_to, b.closing_balance_paise, b.created_at, b.undone_at,
                (SELECT count(*) FROM journal_entries e WHERE e.user_id = b.user_id AND e.import_batch_id = b.id AND e.voided_at IS NULL)::int AS active
         FROM import_batches b JOIN ledger_accounts a ON a.user_id = b.user_id AND a.id = b.account_id
         WHERE b.user_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 50`, [userId]);
    return result.rows.map(row => ({
        id: Number(row.id), account: { id: Number(row.account_id), name: row.account_name }, fileKind: row.file_kind,
        rowsInFile: row.rows_in_file, imported: row.imported, active: row.active, from: row.statement_from, to: row.statement_to,
        closingBalance: row.closing_balance_paise === null ? null : fromPaise(row.closing_balance_paise),
        createdAt: new Date(row.created_at).toISOString(), undoneAt: row.undone_at ? new Date(row.undone_at).toISOString() : null,
    }));
}

export interface ImportProfile { signature: string; presetKey: string | null; mapping: Mapping; accountId: number | null }

/** The column choices remembered for each statement layout, most recently used first */
export async function listProfiles(pool: Pool, userId: number): Promise<ImportProfile[]> {
    const result = await pool.query(
        'SELECT signature, preset_key, mapping, account_id FROM import_profiles WHERE user_id = $1 ORDER BY last_used_at DESC LIMIT 100', [userId]);
    return result.rows.map(row => ({
        signature: row.signature, presetKey: row.preset_key, mapping: row.mapping as Mapping,
        accountId: row.account_id === null ? null : Number(row.account_id),
    }));
}

/**
 * Undo an import: its entries that still count are voided (kept as history), and the entries it
 * replaced with transfers count again. Entries on a reconciled statement need { confirmReconciled: true }.
 */
export async function undoImport(pool: Pool, userId: number, id: string, body: Body = {}): Promise<{ undone: number; restored: number }> {
    if (!/^\d+$/.test(id)) throw new RequestError(404, t('errors.import.notFound'));
    return withTransaction(pool, async (client) => {
        const found = await client.query(
            `SELECT b.id, b.undone_at, b.replaced_entry_ids, a.name AS account_name
             FROM import_batches b JOIN ledger_accounts a ON a.user_id = b.user_id AND a.id = b.account_id
             WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`, [id, userId]);
        const batch = found.rows[0];
        if (!batch) throw new RequestError(404, t('errors.import.notFound'));
        if (batch.undone_at) throw new RequestError(400, t('errors.import.alreadyUndone'));

        const entries = await client.query(
            'SELECT id FROM journal_entries WHERE user_id = $1 AND import_batch_id = $2 AND voided_at IS NULL FOR UPDATE', [userId, batch.id]);
        const entryIds = entries.rows.map(row => Number(row.id));
        const reconciled = await client.query(
            `SELECT a.name, r.statement_date::text AS date
             FROM journal_lines l JOIN reconciliations r ON r.user_id = l.user_id AND r.id = l.reconciliation_id
             JOIN ledger_accounts a ON a.user_id = r.user_id AND a.id = r.account_id
             WHERE l.user_id = $1 AND l.entry_id = ANY($2::bigint[]) AND r.status = 'done' LIMIT 1`, [userId, entryIds]);
        if (reconciled.rows[0] && body.confirmReconciled !== true) {
            throw new RequestError(409, t('errors.import.reconciled', { statement: `the ${reconciled.rows[0].name} statement of ${reconciled.rows[0].date}` }));
        }
        await client.query('UPDATE journal_entries SET voided_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[])', [userId, entryIds]);
        // The replaced entries come back, unless they belong to an import that was itself undone
        const restored = await client.query(
            `UPDATE journal_entries e SET voided_at = NULL
             WHERE e.user_id = $1 AND e.id = ANY($2::bigint[]) AND e.voided_at IS NOT NULL
               AND (e.import_batch_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM import_batches b WHERE b.user_id = e.user_id AND b.id = e.import_batch_id AND b.undone_at IS NOT NULL))`,
            [userId, (batch.replaced_entry_ids as string[]).map(Number)]);
        await client.query('UPDATE import_batches SET undone_at = now() WHERE id = $1 AND user_id = $2', [batch.id, userId]);
        await logActivity(client, userId, 'deleted', 'import', Number(batch.id), `Undid an import into ${batch.account_name}`, null,
            { accountName: batch.account_name, entries: entryIds.length }, { restored: restored.rowCount ?? 0 });
        return { undone: entryIds.length, restored: restored.rowCount ?? 0 };
    });
}

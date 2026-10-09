import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, systemAccount, toPaise, voidEntry, type EntryLine } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { lockedCategory } from './categories';
import { lockedEvent } from './events';
import { entryDate } from './transactions';

/**
 * Money accounts and entries straight in the ledger (docs/ledger.md, v2 Phase 1).
 *
 * Accounts: banks, cash and credit cards (mirroring the former tables), wallets and meal cards
 * (ledger only). Entries: income, expenses and transfers on any of them. A transfer moves money
 * between the user's own accounts (an ATM withdrawal, a card bill payment), so it is neither income
 * nor spending.
 *
 * Income and expenses recorded through the former routes (/api/income, /api/expenses) also have a
 * row in income_entries or expenses. Editing or deleting one of those here removes that row too, so
 * the two never disagree; the entry then lives only in the ledger.
 */

type Body = Record<string, unknown>;
type Client = Pick<PoolClient, 'query'>;

export type MoneyAccountType = 'bank' | 'cash' | 'credit_card' | 'wallet' | 'meal_card';
const MONEY_TYPES: MoneyAccountType[] = ['bank', 'cash', 'credit_card', 'wallet', 'meal_card'];
/** Account types that exist only in the ledger, and so are added and archived here */
const LEDGER_ONLY_TYPES = ['wallet', 'meal_card'];
const BANK_ACCOUNT_TYPES = ['savings', 'current', 'salary', 'nre', 'nro'];
const TYPE_NAMES: Record<MoneyAccountType, string> = {
    bank: 'bank account', cash: 'cash', credit_card: 'credit card', wallet: 'wallet', meal_card: 'meal card',
};

export type EntryKind = 'income' | 'expense' | 'transfer';
const ENTRY_KINDS: EntryKind[] = ['income', 'expense', 'transfer'];

// ----- Accounts -----

export interface MoneyAccount {
    id: number;
    type: MoneyAccountType;
    name: string;
    /** The ledger balance: money held, or for a credit card, minus what is owed */
    balance: string;
    /** Credit cards: what is owed, the limit and what is left */
    used: string | null;
    creditLimit: string | null;
    available: string | null;
    institution: string | null;
    accountType: string | null;
    interestRate: string | null;
    notes: string | null;
    /** Banks and cards: the id of the row in banks or credit_cards (the /api/banks and /api/credit-cards id) */
    sourceId: number | null;
}

const ACCOUNT_COLUMNS = `a.id, a.subtype, a.name, a.institution, a.account_type, a.interest_rate, a.notes, a.source_id,
    a.credit_limit_paise, COALESCE(b.balance_paise, 0)::bigint AS balance_paise`;

function toAccount(row: Record<string, unknown>): MoneyAccount {
    const balance = Number(row.balance_paise);
    const isCard = row.subtype === 'credit_card';
    const limit = row.credit_limit_paise === null ? null : Number(row.credit_limit_paise);
    return {
        id: Number(row.id),
        type: row.subtype as MoneyAccountType,
        name: String(row.name),
        balance: fromPaise(balance),
        used: isCard ? fromPaise(-balance) : null,
        creditLimit: isCard && limit !== null ? fromPaise(limit) : null,
        available: isCard && limit !== null ? fromPaise(limit + balance) : null,
        institution: (row.institution as string | null) ?? null,
        accountType: (row.account_type as string | null) ?? null,
        interestRate: row.interest_rate === null || row.interest_rate === undefined ? null : String(row.interest_rate),
        notes: (row.notes as string | null) ?? null,
        sourceId: row.source_id === null || row.source_id === undefined ? null : Number(row.source_id),
    };
}

/**
 * The user's money accounts that are not archived, banks first, with balances from the ledger.
 * Cash is always there (made the first time it is needed), as it always was in the entry forms.
 */
export async function listAccounts(pool: Pool, userId: number): Promise<MoneyAccount[]> {
    await systemAccount(pool, userId, 'cash');
    const result = await pool.query(
        `SELECT ${ACCOUNT_COLUMNS}
         FROM ledger_accounts a LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         WHERE a.user_id = $1 AND a.archived_at IS NULL AND a.subtype = ANY($2::text[])
         ORDER BY array_position($2::text[], a.subtype), lower(a.name)`,
        [userId, MONEY_TYPES],
    );
    return result.rows.map(toAccount);
}

/** An account or entry without the internal fields used while changing it */
function publicAccount({ sourceTable, ...account }: MoneyAccount & { sourceTable: string | null }): MoneyAccount {
    void sourceTable;
    return account;
}

/** One of the user's money accounts, locked for the rest of the transaction; 400 if it is not theirs or archived */
export async function lockedMoneyAccount(client: Client, userId: number, id: unknown, label = 'Account'): Promise<MoneyAccount & { sourceTable: string | null }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(400, `${label} is required`);
    const result = await client.query(
        `SELECT ${ACCOUNT_COLUMNS}, a.source_table, a.archived_at
         FROM ledger_accounts a LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         WHERE a.id = $1 AND a.user_id = $2 AND a.subtype = ANY($3::text[])
         FOR UPDATE OF a`,
        [id, userId, MONEY_TYPES],
    );
    const row = result.rows[0];
    if (!row || row.archived_at !== null) throw new RequestError(400, `${label} not found`);
    return { ...toAccount(row), sourceTable: row.source_table };
}

function optionalText(value: unknown, field: string, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new RequestError(400, `${field} must be text`);
    const text = value.trim();
    if (text.length > max) throw new RequestError(400, `${field} is too long (max ${max} characters)`);
    return text || null;
}

function requiredName(value: unknown): string {
    const name = optionalText(value, 'Name', 100);
    if (!name) throw new RequestError(400, 'Name is required');
    return name;
}

/** Add a wallet or meal card, with its starting balance as an opening entry */
export async function createAccount(pool: Pool, userId: number, body: Body): Promise<MoneyAccount> {
    const type = body.type;
    if (typeof type !== 'string' || !LEDGER_ONLY_TYPES.includes(type)) {
        throw new RequestError(400, 'Add a wallet or a meal card here; banks, cards and cash have their own forms');
    }
    const name = requiredName(body.name);
    const institution = optionalText(body.institution, 'Provider', 100);
    const notes = optionalText(body.notes, 'Notes', 500);
    const opening = body.openingBalance === undefined || body.openingBalance === '' ? 0 : amountPaise(body.openingBalance, true);

    return withTransaction(pool, async (client) => {
        const clash = await client.query(
            'SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND archived_at IS NULL AND subtype = ANY($2::text[]) AND lower(name) = lower($3)',
            [userId, LEDGER_ONLY_TYPES, name]);
        if (clash.rows.length > 0) throw new RequestError(400, `You already have a wallet or meal card called ${name}`);
        const created = await client.query(
            'INSERT INTO ledger_accounts (user_id, kind, subtype, name, institution, notes) VALUES ($1, \'asset\', $2, $3, $4, $5) RETURNING id',
            [userId, type, name, institution, notes]);
        const id = Number(created.rows[0].id);
        await postEntry(client, {
            userId, description: `Opening balance: ${name}`, type: 'opening_balance',
            lines: [{ accountId: id, paise: opening }, { accountId: await systemAccount(client, userId, 'opening_balance'), paise: -opening }],
        });
        await logActivity(client, userId, 'created', 'account', id, `Added ${TYPE_NAMES[type as MoneyAccountType]}: ${name}`,
            fromPaise(opening), null, { accountName: name, type, openingBalance: fromPaise(opening) });
        return publicAccount(await lockedMoneyAccount(client, userId, id));
    });
}

/**
 * Change an account's details. Wallets and meal cards can be renamed here; banks and cards are
 * renamed on their own forms (their former rows hold the name). A bank also records its account
 * type and savings interest rate.
 */
export async function updateAccount(pool: Pool, userId: number, id: string, body: Body): Promise<MoneyAccount> {
    return withTransaction(pool, async (client) => {
        const account = await lockedMoneyAccount(client, userId, id);
        const name = body.name === undefined ? account.name : requiredName(body.name);
        if (name !== account.name && !LEDGER_ONLY_TYPES.includes(account.type)) {
            throw new RequestError(400, 'Rename banks and cards on their own forms');
        }
        let accountType: string | null = account.accountType;
        let interestRate: string | null = account.interestRate;
        if (account.type === 'bank') {
            if (body.accountType !== undefined) {
                accountType = body.accountType === null || body.accountType === '' ? null : String(body.accountType);
                if (accountType !== null && !BANK_ACCOUNT_TYPES.includes(accountType)) {
                    throw new RequestError(400, 'Account type must be savings, current, salary, NRE or NRO');
                }
            }
            if (body.interestRate !== undefined) {
                interestRate = body.interestRate === null || body.interestRate === '' ? null : String(body.interestRate);
                const rate = Number(interestRate);
                if (interestRate !== null && (!/^\d{1,3}(\.\d{1,3})?$/.test(interestRate) || rate > 100)) {
                    throw new RequestError(400, 'Interest rate must be a percentage between 0 and 100, up to three decimals');
                }
            }
        } else if (body.accountType !== undefined || body.interestRate !== undefined) {
            throw new RequestError(400, 'Only bank accounts have an account type and interest rate');
        }
        const institution = body.institution === undefined ? account.institution : optionalText(body.institution, 'Bank or provider', 100);
        const notes = body.notes === undefined ? account.notes : optionalText(body.notes, 'Notes', 500);

        await client.query(
            `UPDATE ledger_accounts SET name = $1, institution = $2, account_type = $3, interest_rate = $4, notes = $5
             WHERE id = $6 AND user_id = $7`,
            [name, institution, accountType, interestRate, notes, account.id, userId]);
        await logActivity(client, userId, 'updated', 'account', account.id, `Updated ${TYPE_NAMES[account.type]}: ${name}`, null,
            { accountName: account.name, institution: account.institution, accountType: account.accountType, interestRate: account.interestRate, notes: account.notes },
            { accountName: name, institution, accountType, interestRate, notes });
        return publicAccount(await lockedMoneyAccount(client, userId, account.id));
    });
}

/** Archive an empty wallet or meal card: it disappears from the lists, and its history stays */
export async function archiveAccount(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const account = await lockedMoneyAccount(client, userId, id);
        if (!LEDGER_ONLY_TYPES.includes(account.type)) throw new RequestError(400, 'Delete banks and cards on their own forms');
        if (toPaise(account.balance) !== 0) {
            throw new RequestError(400, `${account.name} still holds ₹${account.balance}. Spend it or move it to another account first.`);
        }
        await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE id = $1 AND user_id = $2', [account.id, userId]);
        await logActivity(client, userId, 'deleted', 'account', account.id, `Removed ${TYPE_NAMES[account.type]}: ${account.name}`, null,
            { accountName: account.name, type: account.type }, null);
    });
}

// ----- Entries -----

export interface Entry {
    id: number;
    type: EntryKind;
    date: string;
    description: string;
    amount: string;
    /** Where the money came in (income), went out from (expense, transfer) */
    account: { id: number; name: string; type: MoneyAccountType };
    /** Transfers: where the money went */
    toAccount: { id: number; name: string; type: MoneyAccountType } | null;
    /** Income and expenses: the category (an income or expense account) */
    category: { id: number; name: string } | null;
    /** Free-form labels, sorted */
    tags: string[];
    /** The event or project it is for */
    event: { id: number; name: string } | null;
    /** Recorded through the former routes, with a row in income_entries or expenses */
    legacy: boolean;
}

interface LineRow { account: number; paise: number; kind: string; subtype: string; name: string }

function toEntry(row: Record<string, unknown>): Entry {
    const lines = row.lines as LineRow[];
    const money = lines.filter(line => MONEY_TYPES.includes(line.subtype as MoneyAccountType));
    const other = lines.find(line => line.kind === 'income' || line.kind === 'expense');
    const type = row.entry_type as EntryKind;
    const out = money.find(line => line.paise < 0);
    const into = money.find(line => line.paise > 0);
    const main = type === 'income' ? into : out;
    const amount = Math.abs(Number((main ?? money[0] ?? lines[0])!.paise));
    const ref = (line: LineRow | undefined) => (line ? { id: Number(line.account), name: line.name, type: line.subtype as MoneyAccountType } : null);
    return {
        id: Number(row.id),
        type,
        date: String(row.entry_date),
        description: String(row.description),
        amount: fromPaise(amount),
        account: ref(main ?? money[0])!,
        toAccount: type === 'transfer' ? ref(into) : null,
        category: other ? { id: Number(other.account), name: other.name } : null,
        tags: (row.tags as string[] | null) ?? [],
        event: row.event_id === null || row.event_id === undefined ? null : { id: Number(row.event_id), name: String(row.event_name) },
        legacy: row.source_table !== null,
    };
}

const ENTRY_QUERY = `
    SELECT e.id, e.entry_type, e.entry_date::text AS entry_date, e.description, e.source_table, e.source_id,
           e.event_id, ev.name AS event_name,
           json_agg(json_build_object('account', l.account_id, 'paise', l.amount_paise, 'kind', a.kind,
                                      'subtype', a.subtype, 'name', a.name) ORDER BY l.id) AS lines,
           (SELECT coalesce(json_agg(t.name ORDER BY lower(t.name)), '[]'::json)
            FROM entry_tags et JOIN tags t ON t.user_id = et.user_id AND t.id = et.tag_id
            WHERE et.user_id = e.user_id AND et.entry_id = e.id) AS tags
    FROM journal_entries e
    JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
    JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
    LEFT JOIN events ev ON ev.user_id = e.user_id AND ev.id = e.event_id
    WHERE e.user_id = $1 AND e.voided_at IS NULL AND e.entry_type IN ('income', 'expense', 'transfer')`;

/** Income, expenses and transfers dated in a month (month 1-12), newest first */
export async function listEntries(pool: Pool, userId: number, month: string | null, year: string | null): Promise<Entry[]> {
    const m = Number(month);
    const y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 1900 || y > 9999) {
        throw new RequestError(400, 'Month and year are required');
    }
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const result = await pool.query(
        `${ENTRY_QUERY} AND e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month')
         GROUP BY e.id, ev.id ORDER BY e.entry_date DESC, e.id DESC`,
        [userId, first]);
    return result.rows.map(toEntry);
}

/** Every entry for an event, newest first (its timeline) */
export async function listEntriesForEvent(pool: Pool, userId: number, eventId: number): Promise<Entry[]> {
    const result = await pool.query(`${ENTRY_QUERY} AND e.event_id = $2 GROUP BY e.id, ev.id ORDER BY e.entry_date DESC, e.id DESC`, [userId, eventId]);
    return result.rows.map(toEntry);
}

function publicEntry({ sourceTable, sourceId, ...entry }: Entry & { sourceTable: string | null; sourceId: number | null }): Entry {
    void sourceTable;
    void sourceId;
    return entry;
}

async function lockedEntry(client: Client, userId: number, id: unknown): Promise<Entry & { sourceTable: string | null; sourceId: number | null }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, 'Entry not found');
    await client.query(
        'SELECT id FROM journal_entries WHERE id = $1 AND user_id = $2 AND voided_at IS NULL FOR UPDATE', [id, userId]);
    const result = await client.query(`${ENTRY_QUERY} AND e.id = $2 GROUP BY e.id, ev.id`, [userId, id]);
    const row = result.rows[0];
    if (!row) throw new RequestError(404, 'Entry not found');
    return { ...toEntry(row), sourceTable: row.source_table, sourceId: row.source_id === null ? null : Number(row.source_id) };
}

/** Whole paise from a positive amount (or zero, when allowed) */
function amountPaise(value: unknown, allowZero = false): number {
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, 'Enter a valid amount');
    }
    if (paise < 0 || (paise === 0 && !allowZero)) throw new RequestError(400, 'Enter an amount greater than zero');
    return paise;
}

interface EntryInput {
    type: EntryKind; date: string; description: string; paise: number; accountId: unknown; toAccountId: unknown;
    /** Income and expenses; left out, the fallback ("Uncategorised", "Other income") or, on an edit, the entry's own */
    categoryId: unknown;
    /** Left out on an edit, the entry keeps its tags */
    tags: string[] | undefined;
    /** The event it is for; null or empty for none; left out on an edit, the entry keeps its event */
    eventId: unknown;
}

const MAX_TAGS = 10;

/** Tags from an array or a comma-separated text: trimmed, without repeats (ignoring case), at most 10 of up to 30 characters */
function readTags(value: unknown): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
    if (!raw || raw.some(tag => typeof tag !== 'string')) throw new RequestError(400, 'Tags must be text');
    const tags: string[] = [];
    for (const tag of (raw as string[]).map(item => item.trim()).filter(Boolean)) {
        if (tag.length > 30) throw new RequestError(400, 'A tag can be at most 30 characters');
        if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }
    if (tags.length > MAX_TAGS) throw new RequestError(400, `At most ${MAX_TAGS} tags on an entry`);
    return tags;
}

/** Put these tags on an entry, making any that are new; replaces its tags */
async function setEntryTags(client: Client, userId: number, entryId: number, tags: string[]): Promise<void> {
    await client.query('DELETE FROM entry_tags WHERE user_id = $1 AND entry_id = $2', [userId, entryId]);
    if (tags.length === 0) return;
    await client.query(
        `INSERT INTO tags (user_id, name) SELECT $1, t FROM unnest($2::text[]) AS t
         WHERE NOT EXISTS (SELECT 1 FROM tags WHERE user_id = $1 AND lower(name) = lower(t))`,
        [userId, tags]);
    await client.query(
        `INSERT INTO entry_tags (user_id, entry_id, tag_id)
         SELECT $1, $2, id FROM tags WHERE user_id = $1 AND lower(name) = ANY(SELECT lower(t) FROM unnest($3::text[]) AS t)
         ON CONFLICT DO NOTHING`,
        [userId, entryId, tags]);
}

function readEntry(body: Body): EntryInput {
    const type = body.type;
    if (typeof type !== 'string' || !ENTRY_KINDS.includes(type as EntryKind)) {
        throw new RequestError(400, 'Type must be income, expense or transfer');
    }
    if (!body.date) throw new RequestError(400, 'Date is required');
    const date = entryDate(body.date);
    if (!date) throw new RequestError(400, 'Invalid date format');
    const description = optionalText(body.description, 'Description', 200);
    if (!description) throw new RequestError(400, 'Description is required');
    return {
        type: type as EntryKind, date: date.date, description, paise: amountPaise(body.amount),
        accountId: body.accountId, toAccountId: body.toAccountId, categoryId: body.categoryId, tags: readTags(body.tags),
        eventId: body.eventId,
    };
}

/**
 * Users who also track income cannot overspend: the account money leaves must hold it, or a card
 * must have the limit left. Expenses-only users skip this (as with the former routes).
 */
async function checkCanSpend(client: Client, userId: number, account: MoneyAccount, paise: number): Promise<void> {
    const user = await client.query('SELECT tracking_option FROM users WHERE id = $1', [userId]);
    if ((user.rows[0]?.tracking_option || 'both') === 'expenses') return;
    if (account.type === 'credit_card') {
        if (account.available === null || toPaise(account.available) < paise) throw new RequestError(400, 'Insufficient credit limit');
        return;
    }
    if (toPaise(account.balance) >= paise) return;
    if (account.type === 'bank') throw new RequestError(400, 'Insufficient bank balance');
    if (account.type === 'cash') throw new RequestError(400, 'Insufficient cash balance');
    throw new RequestError(400, `Insufficient balance in ${account.name}`);
}

/** The category account for income or an expense: the one chosen, or the fallback */
async function categoryAccount(client: Client, userId: number, kind: 'income' | 'expense', categoryId: unknown): Promise<{ id: number; name: string }> {
    if (categoryId === undefined || categoryId === null || categoryId === '') {
        const id = await systemAccount(client, userId, kind);
        return { id, name: kind === 'income' ? 'Other income' : 'Uncategorised' };
    }
    const category = await lockedCategory(client, userId, categoryId, kind);
    return { id: category.id, name: category.name };
}

/** Validate the accounts and record the entry with its tags; returns its id */
async function record(client: Client, userId: number, input: EntryInput, checkSpending: boolean, recurring?: { id: number; on: string })
    : Promise<{ id: number; account: MoneyAccount; toAccount: MoneyAccount | null; category: { id: number; name: string } | null }> {
    const account = await lockedMoneyAccount(client, userId, input.accountId);
    // Every reference is checked before the balance
    const eventId = input.eventId === undefined || input.eventId === null || input.eventId === '' ? null
        // The entry's own event, kept as it was (even if the event has since been archived)
        : typeof input.eventId === 'object' && 'keep' in input.eventId ? Number((input.eventId as { keep: number }).keep)
            : (await lockedEvent(client, userId, input.eventId)).id;
    let toAccount: MoneyAccount | null = null;
    let category: { id: number; name: string } | null = null;
    let lines: EntryLine[];
    if (input.type === 'income') {
        if (account.type === 'credit_card') throw new RequestError(400, 'Income goes into a bank, cash, a wallet or a meal card');
        category = await categoryAccount(client, userId, 'income', input.categoryId);
        lines = [{ accountId: account.id, paise: input.paise }, { accountId: category.id, paise: -input.paise }];
    } else if (input.type === 'expense') {
        category = await categoryAccount(client, userId, 'expense', input.categoryId);
        if (checkSpending) await checkCanSpend(client, userId, account, input.paise);
        lines = [{ accountId: category.id, paise: input.paise }, { accountId: account.id, paise: -input.paise }];
    } else {
        toAccount = await lockedMoneyAccount(client, userId, input.toAccountId, 'Destination account');
        if (toAccount.id === account.id) throw new RequestError(400, 'Choose two different accounts for a transfer');
        if (checkSpending) await checkCanSpend(client, userId, account, input.paise);
        lines = [{ accountId: toAccount.id, paise: input.paise }, { accountId: account.id, paise: -input.paise }];
    }
    const id = (await postEntry(client, { userId, date: input.date, description: input.description, type: input.type, eventId, recurring, lines }))!;
    await setEntryTags(client, userId, id, input.tags ?? []);
    return { id, account, toAccount, category };
}

const activityValues = (input: EntryInput, account: MoneyAccount, toAccount: MoneyAccount | null, category: { name: string } | null) => ({
    type: input.type, description: input.description, amount: fromPaise(input.paise), date: input.date,
    accountName: account.name, ...(toAccount ? { toAccountName: toAccount.name } : {}),
    ...(category ? { categoryName: category.name } : {}), ...(input.tags?.length ? { tags: input.tags } : {}),
});

const oldValues = (old: Entry) => ({
    type: old.type, description: old.description, amount: old.amount, date: old.date, accountName: old.account.name,
    ...(old.toAccount ? { toAccountName: old.toAccount.name } : {}), ...(old.category ? { categoryName: old.category.name } : {}),
    ...(old.tags.length ? { tags: old.tags } : {}), ...(old.event ? { eventName: old.event.name } : {}),
});

/**
 * Record a new entry on the caller's transaction, with its activity entry. Repeating entries
 * (lib/services/recurring.ts) use this too, with the date they were due.
 */
export async function recordNewEntry(client: Client, userId: number, body: Body,
    options: { checkSpending: boolean; recurring?: { id: number; on: string } }): Promise<Entry> {
    const input = readEntry(body);
    const { id, account, toAccount, category } = await record(client, userId, input, options.checkSpending, options.recurring);
    await logActivity(client, userId, 'created', input.type, id, `Added ${input.type}: ${input.description}`, fromPaise(input.paise), null,
        { ...activityValues(input, account, toAccount, category), ...(options.recurring ? { repeating: true } : {}) });
    return publicEntry(await lockedEntry(client, userId, id));
}

export async function createEntry(pool: Pool, userId: number, body: Body): Promise<Entry> {
    return withTransaction(pool, client => recordNewEntry(client, userId, body, { checkSpending: true }));
}

/** Remove the former row behind an entry recorded through /api/income or /api/expenses, if any */
async function removeFormerRow(client: Client, userId: number, entry: { sourceTable: string | null; sourceId: number | null }): Promise<void> {
    if (entry.sourceTable === 'income_entries') await client.query('DELETE FROM income_entries WHERE id = $1 AND user_id = $2', [entry.sourceId, userId]);
    if (entry.sourceTable === 'expenses') await client.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [entry.sourceId, userId]);
}

/**
 * Change an entry: the old one is voided (kept as history) and the new one recorded, under a new id.
 * Like the former edit routes, an edit does not run the overspending check.
 */
export async function updateEntry(pool: Pool, userId: number, id: string, body: Body): Promise<Entry> {
    const input = readEntry(body);
    return withTransaction(pool, async (client) => {
        const old = await lockedEntry(client, userId, id);
        await removeFormerRow(client, userId, old);
        await voidEntry(client, userId, old.id);
        // Left out, the category and tags stay as they were
        const kept: EntryInput = {
            ...input,
            categoryId: input.categoryId === undefined && input.type === old.type ? old.category?.id : input.categoryId,
            tags: input.tags ?? old.tags,
            eventId: input.eventId === undefined ? (old.event ? { keep: old.event.id } : null) : input.eventId,
        };
        const { id: newId, account, toAccount, category } = await record(client, userId, kept, false);
        await logActivity(client, userId, 'updated', input.type, newId, `Updated ${input.type}: ${input.description}`, fromPaise(input.paise),
            oldValues(old), activityValues(kept, account, toAccount, category));
        return publicEntry(await lockedEntry(client, userId, newId));
    });
}

export async function deleteEntry(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const old = await lockedEntry(client, userId, id);
        await removeFormerRow(client, userId, old);
        await voidEntry(client, userId, old.id);
        await logActivity(client, userId, 'deleted', old.type, old.id, `Deleted ${old.type}: ${old.description}`, old.amount, oldValues(old), null);
    });
}

const MAX_BULK = 200;

/**
 * { entryIds, categoryId }: put several entries in one category at once (existing spending starts
 * as "Uncategorised"). Each changed entry is voided and recorded again with the new category, under
 * a new id; entries of the other kind are refused. Returns how many changed.
 */
export async function categoriseEntries(pool: Pool, userId: number, body: Body): Promise<{ changed: number }> {
    const ids = body.entryIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !/^\d+$/.test(String(id)))) {
        throw new RequestError(400, 'Choose the entries to categorise');
    }
    if (ids.length > MAX_BULK) throw new RequestError(400, `At most ${MAX_BULK} entries at a time`);
    return withTransaction(pool, async (client) => {
        const category = await lockedCategory(client, userId, body.categoryId);
        let changed = 0;
        for (const id of [...new Set(ids.map(String))]) {
            const old = await lockedEntry(client, userId, id);
            if (old.type !== category.kind) {
                throw new RequestError(400, `${old.description} is ${old.type === 'transfer' ? 'a transfer' : old.type}; ${category.name} is for ${category.kind === 'income' ? 'income' : 'spending'}`);
            }
            if (old.category?.id === category.id) continue;
            await removeFormerRow(client, userId, old);
            await voidEntry(client, userId, old.id);
            await record(client, userId, {
                type: old.type, date: old.date, description: old.description, paise: toPaise(old.amount),
                accountId: old.account.id, toAccountId: null, categoryId: category.id, tags: old.tags, eventId: old.event ? { keep: old.event.id } : null,
            }, false);
            changed++;
        }
        if (changed > 0) {
            await logActivity(client, userId, 'updated', 'category', category.id, `Put ${changed} ${changed === 1 ? 'entry' : 'entries'} in ${category.name}`,
                null, null, { categoryName: category.name, entries: changed });
        }
        return { changed };
    });
}

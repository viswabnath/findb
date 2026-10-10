import type { PoolClient } from 'pg';

/**
 * The double-entry ledger (db/migrations/0001_ledger.sql, docs/ledger.md).
 *
 * Every change to the former tables (banks, credit_cards, cash_balance, income_entries, expenses)
 * also writes the ledger, in the same transaction, and every balance comes from the ledger alone:
 * the former balance columns are no longer written (migration 0009). The view ledger_entry_check
 * proves each income and expense row has its one ledger record, and the tests check it after every
 * kind of change. Amounts in the ledger are whole paise. Every function here runs on the caller's
 * transaction.
 */

type Client = Pick<PoolClient, 'query'>;

export type SystemAccount = 'cash' | 'income' | 'expense' | 'opening_balance' | 'adjustment' | 'reimbursements';
export type EntryType = 'opening_balance' | 'income' | 'expense' | 'adjustment' | 'transfer' | 'reimbursable' | 'reimbursement';
export type SourceTable = 'banks' | 'credit_cards' | 'cash_balance' | 'income_entries' | 'expenses';

const SYSTEM_ACCOUNTS: Record<SystemAccount, { kind: string; subtype: string; name: string }> = {
    cash: { kind: 'asset', subtype: 'cash', name: 'Cash' },
    income: { kind: 'income', subtype: 'income', name: 'Other income' },
    expense: { kind: 'expense', subtype: 'expense', name: 'Uncategorised' },
    opening_balance: { kind: 'equity', subtype: 'opening_balance', name: 'Opening balances' },
    adjustment: { kind: 'equity', subtype: 'adjustment', name: 'Balance adjustments' },
    reimbursements: { kind: 'asset', subtype: 'receivable', name: 'Reimbursements due' },
};

/**
 * An amount in rupees as whole paise, rounded half away from zero to two decimals, exactly as
 * Postgres stores it in a DECIMAL(20,2) column (the former tables). Worked out on the decimal
 * text, never in floating point, so the ledger and the former tables agree to the paisa.
 */
export function toPaise(value: unknown): number {
    let text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
        const number = Number(text);
        if (text === '' || !Number.isFinite(number)) throw new Error(`Not an amount: ${String(value)}`);
        text = number.toFixed(10);
    }
    const negative = text.startsWith('-');
    const unsigned = text.replace(/^[+-]/, '');
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const digits = BigInt((whole || '0') + (fraction + '00').slice(0, 2));
    const roundUp = Number((fraction + '000').charAt(2)) >= 5;
    const paise = digits + (roundUp ? 1n : 0n);
    if (paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Amount too large: ${String(value)}`);
    return negative ? -Number(paise) : Number(paise);
}

/** Whole paise as rupees text with two decimals, as Postgres returns a DECIMAL(20,2): 123456 is "1234.56" */
export function fromPaise(paise: number | string | bigint): string {
    const value = BigInt(paise);
    const unsigned = value < 0n ? -value : value;
    const text = `${unsigned / 100n}.${String(unsigned % 100n).padStart(2, '0')}`;
    return value < 0n ? `-${text}` : text;
}

/** The id of one of the user's built-in accounts, created the first time it is needed */
export async function systemAccount(client: Client, userId: number, key: SystemAccount): Promise<number> {
    const account = SYSTEM_ACCOUNTS[key];
    await client.query(
        `INSERT INTO ledger_accounts (user_id, kind, subtype, name, system_key) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
        [userId, account.kind, account.subtype, account.name, key],
    );
    const result = await client.query('SELECT id FROM ledger_accounts WHERE user_id = $1 AND system_key = $2', [userId, key]);
    return Number(result.rows[0].id);
}

/** The ledger account that mirrors a bank or card row, created the first time it is needed */
async function mirroredAccount(client: Client, userId: number, table: 'banks' | 'credit_cards', sourceId: unknown): Promise<number> {
    const existing = await client.query(
        'SELECT id FROM ledger_accounts WHERE source_table = $1 AND source_id = $2 AND user_id = $3', [table, sourceId, userId]);
    if (existing.rows.length > 0) return Number(existing.rows[0].id);

    const row = await client.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2`, [sourceId, userId]);
    if (row.rows.length === 0) throw new Error(`No ${table} row ${String(sourceId)} for user ${userId}`);
    const isCard = table === 'credit_cards';
    const created = await client.query(
        `INSERT INTO ledger_accounts (user_id, kind, subtype, name, credit_limit_paise, source_table, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, isCard ? 'liability' : 'asset', isCard ? 'credit_card' : 'bank', row.rows[0].name,
            isCard ? toPaise(row.rows[0].credit_limit) : null, table, sourceId],
    );
    return Number(created.rows[0].id);
}

export const bankAccount = (client: Client, userId: number, bankId: unknown) => mirroredAccount(client, userId, 'banks', bankId);
export const cardAccount = (client: Client, userId: number, cardId: unknown) => mirroredAccount(client, userId, 'credit_cards', cardId);

/** The account behind an entry's "bank", "cash" or "credit_card" with its id */
export async function moneyAccount(client: Client, userId: number, type: unknown, sourceId: unknown): Promise<number> {
    if (type === 'cash') return systemAccount(client, userId, 'cash');
    if (type === 'bank') return bankAccount(client, userId, sourceId);
    if (type === 'credit_card') return cardAccount(client, userId, sourceId);
    throw new Error(`Unknown account type: ${String(type)}`);
}

export interface EntryLine {
    accountId: number;
    /** Positive moves money into the account, negative moves it out */
    paise: number;
}

export interface NewEntry {
    userId: number;
    /** YYYY-MM-DD; today when left out */
    date?: string;
    description: string;
    type: EntryType;
    source?: { table: SourceTable; id: unknown };
    /** The event or project the entry is for (events, migration 0012) */
    eventId?: number | null;
    /** A repeating entry this records, and the date it was due (migration 0013) */
    recurring?: { id: number; on: string } | null;
    /** The reimbursement this entry belongs to (migration 0014) */
    reimbursementId?: number | null;
    /** Part of the sample data (migration 0018, lib/services/sample-data.ts) */
    sample?: boolean;
    lines: EntryLine[];
}

/**
 * Record one journal entry. Lines of zero are left out, and an entry whose lines are all zero is
 * not recorded at all. The lines must add up to zero: checked here, and again by the database
 * when the transaction commits.
 */
export async function postEntry(client: Client, entry: NewEntry): Promise<number | null> {
    const lines = entry.lines.filter(line => line.paise !== 0);
    if (lines.length === 0) return null;
    if (lines.reduce((sum, line) => sum + line.paise, 0) !== 0) {
        throw new Error(`Journal entry does not balance: ${entry.description}`);
    }
    const created = await client.query(
        `INSERT INTO journal_entries (user_id, entry_date, description, entry_type, source_table, source_id, event_id, recurring_id, recurring_on, reimbursement_id, sample)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [entry.userId, entry.date ?? null, entry.description, entry.type, entry.source?.table ?? null, entry.source?.id ?? null,
            entry.eventId ?? null, entry.recurring?.id ?? null, entry.recurring?.on ?? null, entry.reimbursementId ?? null, entry.sample ?? false],
    );
    const entryId = Number(created.rows[0].id);
    for (const line of lines) {
        await client.query(
            'INSERT INTO journal_lines (user_id, entry_id, account_id, amount_paise) VALUES ($1, $2, $3, $4)',
            [entry.userId, entryId, line.accountId, line.paise],
        );
    }
    return entryId;
}

/**
 * Void the entries recorded for a row (all of them, or only some types). Voided entries stay in the
 * ledger as history but no longer count towards any balance.
 */
export async function voidEntries(client: Client, userId: number, table: SourceTable, sourceId: unknown, types?: EntryType[]): Promise<void> {
    await client.query(
        `UPDATE journal_entries SET voided_at = now()
         WHERE user_id = $1 AND source_table = $2 AND source_id = $3 AND voided_at IS NULL
           AND ($4::text[] IS NULL OR entry_type = ANY($4::text[]))`,
        [userId, table, sourceId, types ?? null],
    );
}

/** Void one entry by its id (an entry recorded directly in the ledger, with no former row) */
export async function voidEntry(client: Client, userId: number, entryId: number): Promise<void> {
    await client.query('UPDATE journal_entries SET voided_at = now() WHERE id = $1 AND user_id = $2 AND voided_at IS NULL', [entryId, userId]);
}

/** An account's balance in paise, from the entries that still count */
export async function accountBalance(client: Client, accountId: number): Promise<number> {
    const result = await client.query(
        `SELECT COALESCE(SUM(l.amount_paise), 0)::bigint AS balance
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = $1 AND e.voided_at IS NULL`,
        [accountId],
    );
    return Number(result.rows[0].balance);
}

export interface Balances {
    /** By ledger account id, every account */
    accounts: Map<number, number>;
    /** By bank id: positive is money in the bank */
    banks: Map<number, number>;
    /** By card id: negative is money owed on the card */
    cards: Map<number, number>;
    /** The built-in accounts that have been created, by key */
    system: Partial<Record<SystemAccount, number>>;
}

/**
 * Every account's balance in paise, from the entries that still count: all of them, or only those
 * dated on or before `asOf` (YYYY-MM-DD).
 */
export async function balances(client: Client, userId: number, asOf?: string): Promise<Balances> {
    const result = await client.query(
        `SELECT a.id, a.source_table, a.source_id, a.system_key,
                COALESCE(SUM(l.amount_paise) FILTER (WHERE e.voided_at IS NULL AND ($2::date IS NULL OR e.entry_date <= $2::date)), 0)::bigint AS paise
         FROM ledger_accounts a
         LEFT JOIN journal_lines l ON l.user_id = a.user_id AND l.account_id = a.id
         LEFT JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         WHERE a.user_id = $1
         GROUP BY a.id`,
        [userId, asOf ?? null],
    );
    const found: Balances = { accounts: new Map(), banks: new Map(), cards: new Map(), system: {} };
    for (const row of result.rows) {
        const paise = Number(row.paise);
        found.accounts.set(Number(row.id), paise);
        if (row.source_table === 'banks') found.banks.set(Number(row.source_id), paise);
        else if (row.source_table === 'credit_cards') found.cards.set(Number(row.source_id), paise);
        else if (row.system_key) found.system[row.system_key as SystemAccount] = paise;
    }
    return found;
}

/**
 * Income and spending in paise between two dates (YYYY-MM-DD, both included), from the entries that
 * still count: the lines on income and expense accounts. Transfers move money between the user's
 * own accounts, so they touch neither and count as neither (v2 plan: net savings = income - expenses).
 */
export async function flows(client: Client, userId: number, from: string, to: string): Promise<{ income: number; expenses: number }> {
    const result = await client.query(
        `SELECT a.kind, COALESCE(SUM(l.amount_paise), 0)::bigint AS paise
         FROM journal_lines l
         JOIN journal_entries e ON e.user_id = l.user_id AND e.id = l.entry_id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE l.user_id = $1 AND e.voided_at IS NULL AND e.entry_date BETWEEN $2::date AND $3::date
           AND a.kind IN ('income', 'expense')
         GROUP BY a.kind`,
        [userId, from, to],
    );
    const by = Object.fromEntries(result.rows.map(row => [row.kind, Number(row.paise)]));
    // Income accounts are credited (negative) when money comes in
    return { income: -(by.income ?? 0), expenses: by.expense ?? 0 };
}

// ----- What each change to the former tables records -----

interface IncomeRow { id: unknown; source: string; amount: unknown; credited_to_type: unknown; credited_to_id: unknown; date: unknown }
interface ExpenseRow { id: unknown; title: string; amount: unknown; payment_method: unknown; payment_source_id: unknown; date: unknown }

/** YYYY-MM-DD from a DATE value as pg returns it (a Date at local midnight) or as stored text */
function dateText(value: unknown): string | undefined {
    if (value instanceof Date) {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return typeof value === 'string' ? value.slice(0, 10) : undefined;
}

/** Income: into the bank or cash it was credited to, out of Income */
export async function recordIncome(client: Client, userId: number, row: IncomeRow): Promise<void> {
    const paise = toPaise(row.amount);
    await postEntry(client, {
        userId, date: dateText(row.date), description: row.source, type: 'income', source: { table: 'income_entries', id: row.id },
        lines: [
            { accountId: await moneyAccount(client, userId, row.credited_to_type, row.credited_to_id), paise },
            { accountId: await systemAccount(client, userId, 'income'), paise: -paise },
        ],
    });
}

/** An expense: into Uncategorised, out of the bank, card or cash that paid */
export async function recordExpense(client: Client, userId: number, row: ExpenseRow): Promise<void> {
    const paise = toPaise(row.amount);
    await postEntry(client, {
        userId, date: dateText(row.date), description: row.title, type: 'expense', source: { table: 'expenses', id: row.id },
        lines: [
            { accountId: await systemAccount(client, userId, 'expense'), paise },
            { accountId: await moneyAccount(client, userId, row.payment_method, row.payment_source_id), paise: -paise },
        ],
    });
}

/**
 * A bank's starting balance: into the bank, from Opening balances. Dated the day the bank was
 * added, also when the starting balance is edited later, so earlier months keep it.
 */
export async function recordBankOpening(client: Client, userId: number, bankId: unknown, name: string, initialBalance: unknown): Promise<void> {
    const paise = toPaise(initialBalance ?? 0);
    const added = await client.query('SELECT created_at::date::text AS day FROM banks WHERE id = $1 AND user_id = $2', [bankId, userId]);
    await postEntry(client, {
        userId, date: added.rows[0]?.day, description: `Opening balance: ${name}`, type: 'opening_balance', source: { table: 'banks', id: bankId },
        lines: [
            { accountId: await bankAccount(client, userId, bankId), paise },
            { accountId: await systemAccount(client, userId, 'opening_balance'), paise: -paise },
        ],
    });
}

/**
 * Make the cash account's balance equal `balance` (the Setup screen sets cash to an amount, it does
 * not add to it): the difference is recorded against Opening balances the first time, dated the day
 * the user registered (the cash they started with), and against Balance adjustments, dated today,
 * after that.
 */
export async function recordCashSetTo(client: Client, userId: number, cashRowId: unknown, balance: unknown, first: boolean): Promise<void> {
    const cash = await systemAccount(client, userId, 'cash');
    const difference = toPaise(balance ?? 0) - await accountBalance(client, cash);
    const registered = first ? (await client.query('SELECT created_at::date::text AS day FROM users WHERE id = $1', [userId])).rows[0]?.day : undefined;
    await postEntry(client, {
        userId, date: registered, description: first ? 'Opening balance: Cash' : 'Cash balance set by hand', type: first ? 'opening_balance' : 'adjustment',
        source: { table: 'cash_balance', id: cashRowId },
        lines: [
            { accountId: cash, paise: difference },
            { accountId: await systemAccount(client, userId, first ? 'opening_balance' : 'adjustment'), paise: -difference },
        ],
    });
}

/** Rename a bank's or card's account, and update a card's limit */
export async function updateMirroredAccount(client: Client, userId: number, table: 'banks' | 'credit_cards', sourceId: unknown,
    name: string, creditLimit?: unknown): Promise<void> {
    const accountId = await mirroredAccount(client, userId, table, sourceId);
    await client.query('UPDATE ledger_accounts SET name = $1, credit_limit_paise = COALESCE($2, credit_limit_paise) WHERE id = $3',
        [name, creditLimit === undefined ? null : toPaise(creditLimit), accountId]);
}

/** A deleted bank or card: its entries are voided and its account archived (kept as history) */
export async function archiveMirroredAccount(client: Client, userId: number, table: 'banks' | 'credit_cards', sourceId: unknown): Promise<void> {
    await voidEntries(client, userId, table, sourceId);
    await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE source_table = $1 AND source_id = $2 AND user_id = $3',
        [table, sourceId, userId]);
}

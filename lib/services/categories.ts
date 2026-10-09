import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, suggestByKeyword, titleWords } from '../categories';
import { systemAccount } from '../ledger';
import { RequestError, withTransaction } from '../transaction';

/**
 * Categories (docs/ledger.md): income and expense accounts in the ledger. Each user has the
 * defaults (lib/categories.ts), made the first time they are needed, plus their own. The built-in
 * fallbacks, "Uncategorised" for spending and "Other income", always exist and cannot be removed.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;
export type CategoryKind = 'income' | 'expense';

export interface Category {
    id: number;
    kind: CategoryKind;
    name: string;
    /** The default category it started as (groceries, salary); null for the user's own */
    key: string | null;
    /** Spending: essential or discretionary; null for income and the fallback */
    essential: boolean | null;
    /** The fallback ("Uncategorised", "Other income"): always there, never removed */
    fallback: boolean;
}

/** Make the default categories and the fallbacks, if they are not there yet (a removed default stays removed) */
export async function ensureCategories(client: Client, userId: number): Promise<void> {
    await systemAccount(client, userId, 'expense');
    await systemAccount(client, userId, 'income');
    const rows = [
        ...EXPENSE_CATEGORIES.map(category => ({ kind: 'expense', ...category })),
        ...INCOME_CATEGORIES.map(category => ({ kind: 'income', ...category, essential: null })),
    ];
    await client.query(
        `INSERT INTO ledger_accounts (user_id, kind, subtype, name, category_key, essential)
         SELECT $1, d.kind, d.kind, d.name, d.key, d.essential
         FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[]) AS d (kind, name, key, essential)
         ON CONFLICT (user_id, category_key) WHERE category_key IS NOT NULL DO NOTHING`,
        [userId, rows.map(row => row.kind), rows.map(row => row.name), rows.map(row => row.key), rows.map(row => row.essential ?? null)],
    );
}

const CATEGORY_COLUMNS = 'id, kind, name, category_key, essential, system_key';

function toCategory(row: Record<string, unknown>): Category {
    return {
        id: Number(row.id),
        kind: row.kind as CategoryKind,
        name: String(row.name),
        key: (row.category_key as string | null) ?? null,
        essential: row.kind === 'expense' && row.system_key === null ? (row.essential as boolean | null) ?? false : null,
        fallback: row.system_key !== null,
    };
}

/** The user's categories that are not removed: spending first, in the default order, then their own, the fallback last */
export async function listCategories(pool: Pool, userId: number): Promise<Category[]> {
    await ensureCategories(pool, userId);
    const order = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map(category => category.key);
    const result = await pool.query(
        `SELECT ${CATEGORY_COLUMNS} FROM ledger_accounts
         WHERE user_id = $1 AND kind IN ('income', 'expense') AND archived_at IS NULL
         ORDER BY kind, system_key IS NOT NULL, coalesce(array_position($2::text[], category_key), 1000), lower(name)`,
        [userId, order],
    );
    return result.rows.map(toCategory);
}

/** One of the user's categories, locked; 400 if it is not theirs, removed, or of the wrong kind */
export async function lockedCategory(client: Client, userId: number, id: unknown, kind?: CategoryKind): Promise<Category> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(400, 'Category not found');
    const result = await client.query(
        `SELECT ${CATEGORY_COLUMNS}, archived_at FROM ledger_accounts
         WHERE id = $1 AND user_id = $2 AND kind IN ('income', 'expense') FOR UPDATE`,
        [id, userId],
    );
    const row = result.rows[0];
    if (!row || row.archived_at !== null) throw new RequestError(400, 'Category not found');
    if (kind && row.kind !== kind) {
        throw new RequestError(400, kind === 'income' ? 'Choose an income category for income' : 'Choose a spending category for an expense');
    }
    return toCategory(row);
}

function categoryName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new RequestError(400, 'Category name is required');
    const name = value.trim();
    if (name.length > 60) throw new RequestError(400, 'Category name is too long (max 60 characters)');
    return name;
}

async function refuseDuplicate(client: Client, userId: number, kind: CategoryKind, name: string, exceptId?: number): Promise<void> {
    const clash = await client.query(
        'SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND kind = $2 AND archived_at IS NULL AND lower(name) = lower($3) AND id <> $4',
        [userId, kind, name, exceptId ?? 0]);
    if (clash.rows.length > 0) throw new RequestError(400, `You already have a category called ${name}`);
}

/** { kind: "income" | "expense", name, essential? }: a category of the user's own */
export async function createCategory(pool: Pool, userId: number, body: Body): Promise<Category> {
    const kind = body.kind;
    if (kind !== 'income' && kind !== 'expense') throw new RequestError(400, 'Kind must be income or expense');
    const name = categoryName(body.name);
    return withTransaction(pool, async (client) => {
        await ensureCategories(client, userId);
        await refuseDuplicate(client, userId, kind, name);
        const created = await client.query(
            `INSERT INTO ledger_accounts (user_id, kind, subtype, name, essential) VALUES ($1, $2, $2, $3, $4) RETURNING ${CATEGORY_COLUMNS}`,
            [userId, kind, name, kind === 'expense' ? body.essential === true : null]);
        const category = toCategory(created.rows[0]);
        await logActivity(client, userId, 'created', 'category', category.id, `Added category: ${name}`, null, null, { name, kind, essential: category.essential });
        return category;
    });
}

/** { name?, essential? }: rename a category, or mark spending essential or discretionary. The fallbacks keep their names */
export async function updateCategory(pool: Pool, userId: number, id: string, body: Body): Promise<Category> {
    return withTransaction(pool, async (client) => {
        const category = await lockedCategory(client, userId, id);
        const name = body.name === undefined ? category.name : categoryName(body.name);
        if (category.fallback && (name !== category.name || body.essential !== undefined)) {
            throw new RequestError(400, `${category.name} is built in and cannot be changed`);
        }
        if (body.essential !== undefined && (category.kind !== 'expense' || typeof body.essential !== 'boolean')) {
            throw new RequestError(400, 'Only spending categories are essential or not');
        }
        if (name !== category.name) await refuseDuplicate(client, userId, category.kind, name, category.id);
        const essential = body.essential === undefined ? category.essential : body.essential;
        const updated = await client.query(
            `UPDATE ledger_accounts SET name = $1, essential = $2 WHERE id = $3 AND user_id = $4 RETURNING ${CATEGORY_COLUMNS}`,
            [name, essential, category.id, userId]);
        await logActivity(client, userId, 'updated', 'category', category.id, `Updated category: ${name}`, null,
            { name: category.name, essential: category.essential }, { name, essential });
        return toCategory(updated.rows[0]);
    });
}

/** Remove a category: it leaves the lists, and the entries that use it keep it in their history */
export async function archiveCategory(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const category = await lockedCategory(client, userId, id);
        if (category.fallback) throw new RequestError(400, `${category.name} is built in and cannot be removed`);
        await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE id = $1 AND user_id = $2', [category.id, userId]);
        await logActivity(client, userId, 'deleted', 'category', category.id, `Removed category: ${category.name}`, null, { name: category.name }, null);
    });
}

/**
 * The category a title suggests: the one the user chose last time for the same title, then for a
 * title starting with the same word, then a default category by keyword (lib/categories.ts).
 */
export async function suggestCategory(pool: Pool, userId: number, kind: unknown, description: unknown)
    : Promise<{ category: Category | null; reason: 'history' | 'keyword' | null }> {
    if (kind !== 'income' && kind !== 'expense') throw new RequestError(400, 'Kind must be income or expense');
    const title = typeof description === 'string' ? description.trim() : '';
    if (!title) return { category: null, reason: null };
    await ensureCategories(pool, userId);

    const pastChoice = async (condition: string, value: string) => (await pool.query(
        `SELECT ${CATEGORY_COLUMNS.split(', ').map(column => `a.${column}`).join(', ')}
         FROM journal_entries e
         JOIN journal_lines l ON l.user_id = e.user_id AND l.entry_id = e.id
         JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
         WHERE e.user_id = $1 AND e.voided_at IS NULL AND a.kind = $2 AND a.system_key IS NULL AND a.archived_at IS NULL
           AND ${condition}
         ORDER BY e.entry_date DESC, e.id DESC LIMIT 1`,
        [userId, kind, value])).rows[0];

    const same = await pastChoice('lower(e.description) = lower($3)', title);
    if (same) return { category: toCategory(same), reason: 'history' };
    const [first] = titleWords(title);
    if (first && first.length >= 3) {
        const similar = await pastChoice('lower(split_part(e.description, \' \', 1)) = $3', first);
        if (similar) return { category: toCategory(similar), reason: 'history' };
    }
    const key = suggestByKeyword(title, kind);
    if (key) {
        const found = await pool.query(
            `SELECT ${CATEGORY_COLUMNS} FROM ledger_accounts WHERE user_id = $1 AND category_key = $2 AND archived_at IS NULL`, [userId, key]);
        if (found.rows[0]) return { category: toCategory(found.rows[0]), reason: 'keyword' };
    }
    return { category: null, reason: null };
}

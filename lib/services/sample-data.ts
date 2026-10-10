import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { postEntry, systemAccount, toPaise, type EntryType } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { ensureCategories } from './categories';
import { todayInIndia } from './recurring';

/**
 * Sample data (v2 plan, Phase 1): a new user can explore FinDB filled with a sample family's
 * money, then clear it with one click. Every row it makes carries sample = true (migration 0018),
 * account names end in "(SAMPLE)", and the database refuses any real entry while it is loaded, so
 * sample and real money never meet in a total. Clearing deletes exactly the sample rows.
 */

type Client = Pick<PoolClient, 'query'>;

const SAMPLE_BANKS = [
    { key: 'salary', name: 'HDFC SAVINGS (SAMPLE)', opening: 120000 },
    { key: 'home', name: 'SBI SAVINGS (SAMPLE)', opening: 45000 },
];
const SAMPLE_CARD = { name: 'HDFC REGALIA CARD (SAMPLE)', limit: 200000 };
const SAMPLE_EVENT = 'Goa trip (sample)';

type Money = 'salary' | 'home' | 'card';
interface Planned { day: number; type: 'income' | 'expense'; description: string; amount: number; account: Money; category: string; tags?: string[]; event?: boolean }

/** One month of the sample family's money: two earners, a home, a child at school */
const MONTH: Planned[] = [
    { day: 1, type: 'income', description: 'Salary', amount: 95000, account: 'salary', category: 'salary' },
    { day: 3, type: 'expense', description: 'House rent', amount: 25000, account: 'salary', category: 'rent' },
    { day: 5, type: 'income', description: 'Freelance design work', amount: 18000, account: 'home', category: 'freelance' },
    { day: 7, type: 'expense', description: 'Electricity bill', amount: 2340, account: 'home', category: 'bills' },
    { day: 9, type: 'expense', description: 'Groceries, BigBasket', amount: 6800, account: 'card', category: 'groceries', tags: ['family'] },
    { day: 12, type: 'expense', description: 'School fees', amount: 8500, account: 'home', category: 'education', tags: ['kids'] },
    { day: 15, type: 'expense', description: 'Petrol', amount: 3200, account: 'card', category: 'fuel' },
    { day: 18, type: 'expense', description: 'Swiggy dinner', amount: 1450, account: 'card', category: 'restaurants' },
    { day: 22, type: 'expense', description: 'Mobile and broadband', amount: 999, account: 'card', category: 'bills' },
    { day: 25, type: 'expense', description: 'Medicines', amount: 780, account: 'home', category: 'health', tags: ['family'] },
    { day: 27, type: 'expense', description: 'Netflix', amount: 649, account: 'card', category: 'subscriptions' },
];

/** The trip, in the middle month */
const TRIP: Planned[] = [
    { day: 14, type: 'expense', description: 'Flights to Goa', amount: 11200, account: 'card', category: 'travel', tags: ['goa trip'], event: true },
    { day: 16, type: 'expense', description: 'Beach resort, 3 nights', amount: 14000, account: 'card', category: 'travel', tags: ['goa trip'], event: true },
    { day: 17, type: 'expense', description: 'Seafood dinner', amount: 3600, account: 'card', category: 'restaurants', tags: ['goa trip'], event: true },
];

export async function hasSampleData(pool: Pool | Client, userId: number): Promise<boolean> {
    const result = await pool.query('SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND sample LIMIT 1', [userId]);
    return result.rows.length > 0;
}

/** YYYY-MM-DD of a day in the month `back` months before `today`'s, capped at the month's end */
function dayOf(today: string, back: number, day: number): string {
    const [year, month] = today.split('-').map(Number);
    const first = new Date(Date.UTC(year!, month! - 1 - back, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    return first.toISOString().slice(0, 10);
}

async function sampleTag(client: Client, userId: number, name: string): Promise<number> {
    await client.query(
        'INSERT INTO tags (user_id, name, sample) VALUES ($1, $2, true) ON CONFLICT (user_id, lower(name)) DO NOTHING', [userId, name]);
    const result = await client.query('SELECT id FROM tags WHERE user_id = $1 AND lower(name) = lower($2)', [userId, name]);
    return Number(result.rows[0].id);
}

/** Fill the account with three months of a sample family's money. Only for a fresh start. */
export async function loadSampleData(pool: Pool, userId: number, today = todayInIndia()): Promise<{ entries: number }> {
    return withTransaction(pool, async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (await hasSampleData(client, userId)) throw new RequestError(400, 'Sample data is already loaded');
        const own = await client.query('SELECT 1 FROM journal_entries WHERE user_id = $1 AND voided_at IS NULL AND NOT sample LIMIT 1', [userId]);
        if (own.rows.length > 0) throw new RequestError(400, 'Sample data is for a fresh start, and you already have entries of your own');

        await ensureCategories(client, userId);
        const categories = await client.query('SELECT id, category_key FROM ledger_accounts WHERE user_id = $1 AND category_key IS NOT NULL', [userId]);
        const category = (key: string) => Number(categories.rows.find(row => row.category_key === key)!.id);
        const start = dayOf(today, 2, 1);
        const accounts = {} as Record<Money, number>;
        let count = 0;
        const post = async (date: string, description: string, type: EntryType, lines: { accountId: number; paise: number }[], eventId?: number) => {
            const id = await postEntry(client, { userId, date, description, type, lines, eventId: eventId ?? null, sample: true });
            count++;
            return id!;
        };

        // Banks and the card, in the former tables too (the Accounts screen lists those), dated the start
        for (const bank of SAMPLE_BANKS) {
            const row = await client.query(
                'INSERT INTO banks (user_id, name, initial_balance, current_balance, sample, created_at) VALUES ($1, $2, $3, $3, true, $4::date) RETURNING id',
                [userId, bank.name, bank.opening, start]);
            const account = await client.query(
                `INSERT INTO ledger_accounts (user_id, kind, subtype, name, source_table, source_id, sample)
                 VALUES ($1, 'asset', 'bank', $2, 'banks', $3, true) RETURNING id`, [userId, bank.name, row.rows[0].id]);
            accounts[bank.key as Money] = Number(account.rows[0].id);
            const paise = toPaise(bank.opening);
            await postEntry(client, {
                userId, date: start, description: `Opening balance: ${bank.name}`, type: 'opening_balance', source: { table: 'banks', id: row.rows[0].id }, sample: true,
                lines: [{ accountId: accounts[bank.key as Money], paise }, { accountId: await systemAccount(client, userId, 'opening_balance'), paise: -paise }],
            });
            count++;
        }
        const card = await client.query(
            'INSERT INTO credit_cards (user_id, name, credit_limit, sample, created_at) VALUES ($1, $2, $3, true, $4::date) RETURNING id',
            [userId, SAMPLE_CARD.name, SAMPLE_CARD.limit, start]);
        const cardAccount = await client.query(
            `INSERT INTO ledger_accounts (user_id, kind, subtype, name, credit_limit_paise, source_table, source_id, sample)
             VALUES ($1, 'liability', 'credit_card', $2, $3, 'credit_cards', $4, true) RETURNING id`,
            [userId, SAMPLE_CARD.name, toPaise(SAMPLE_CARD.limit), card.rows[0].id]);
        accounts.card = Number(cardAccount.rows[0].id);

        const event = await client.query(
            'INSERT INTO events (user_id, name, starts_on, ends_on, budget_paise, one_off, sample) VALUES ($1, $2, $3, $4, $5, true, true) RETURNING id',
            [userId, SAMPLE_EVENT, dayOf(today, 1, 14), dayOf(today, 1, 17), toPaise(30000)]);
        const eventId = Number(event.rows[0].id);

        for (let back = 2; back >= 0; back--) {
            const planned = back === 1 ? [...MONTH, ...TRIP] : MONTH;
            let cardSpent = 0;
            for (const item of [...planned].sort((a, b) => a.day - b.day)) {
                const date = dayOf(today, back, item.day);
                if (date > today) continue;
                const paise = toPaise(item.amount);
                const money = accounts[item.account];
                const entryId = await post(date, item.description, item.type,
                    item.type === 'income'
                        ? [{ accountId: money, paise }, { accountId: category(item.category), paise: -paise }]
                        : [{ accountId: money, paise: -paise }, { accountId: category(item.category), paise }],
                    item.event ? eventId : undefined);
                for (const tag of item.tags ?? []) {
                    await client.query('INSERT INTO entry_tags (user_id, entry_id, tag_id) VALUES ($1, $2, $3)', [userId, entryId, await sampleTag(client, userId, tag)]);
                }
                if (item.account === 'card') cardSpent += paise;
            }
            // The card bill is paid in full from the salary account early the next month
            const billDate = dayOf(today, back - 1, 4);
            if (cardSpent > 0 && back > 0 && billDate <= today) {
                await post(billDate, `Card bill: ${SAMPLE_CARD.name}`, 'transfer',
                    [{ accountId: accounts.salary, paise: -cardSpent }, { accountId: accounts.card, paise: cardSpent }]);
            }
        }

        await logActivity(client, userId, 'create', 'sample_data', userId, `Loaded sample data: ${count} entries`, null, null, { entries: count });
        return { entries: count };
    });
}

/** Delete every sample row: entries (with their lines and tags), accounts, banks, cards, the event, tags */
export async function clearSampleData(pool: Pool, userId: number): Promise<{ cleared: boolean }> {
    return withTransaction(pool, async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (!(await hasSampleData(client, userId))) return { cleared: false };
        const sampleAccounts = 'SELECT id FROM ledger_accounts WHERE user_id = $1 AND sample';
        await client.query('DELETE FROM journal_entries WHERE user_id = $1 AND sample', [userId]);
        // Anything the user set up around the sample accounts goes with them
        await client.query(`DELETE FROM recurring_entries WHERE user_id = $1 AND (account_id IN (${sampleAccounts}) OR to_account_id IN (${sampleAccounts}))`, [userId]);
        await client.query(`DELETE FROM reconciliations WHERE user_id = $1 AND account_id IN (${sampleAccounts})`, [userId]);
        await client.query('DELETE FROM ledger_accounts WHERE user_id = $1 AND sample', [userId]);
        await client.query('DELETE FROM banks WHERE user_id = $1 AND sample', [userId]);
        await client.query('DELETE FROM credit_cards WHERE user_id = $1 AND sample', [userId]);
        await client.query('DELETE FROM events WHERE user_id = $1 AND sample', [userId]);
        await client.query('DELETE FROM tags t WHERE t.user_id = $1 AND t.sample AND NOT EXISTS (SELECT 1 FROM entry_tags et WHERE et.tag_id = t.id)', [userId]);
        await logActivity(client, userId, 'delete', 'sample_data', userId, 'Cleared the sample data');
        return { cleared: true };
    });
}

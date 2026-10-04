#!/usr/bin/env node
/**
 * Checks the ledger (docs/ledger.md) and changes nothing:
 *   - every bank, card and cash balance in the former tables equals the ledger's (ledger_balance_check)
 *   - every journal entry has at least two lines that add up to zero
 *
 *   npm run ledger:check         production (.env, schema public); read-only
 *   npm run ledger:check:test    the test database (.env.test, schema balancetrack_test)
 *
 * Prints what differs and exits with 1 when anything does, 0 when the ledger agrees.
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
    const schema = process.env.DB_SCHEMA || 'public';
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        options: `-c search_path=${schema}`,
        connectionTimeoutMillis: 10000,
    });
    await client.connect();
    console.log(`Database ${process.env.DB_HOST}, schema ${schema}`);

    try {
        // One read-only transaction, so a mistake here can never change data. Never a session SET:
        // through Supabase's transaction pooler it would stay on a shared server connection.
        await client.query('BEGIN TRANSACTION READ ONLY');

        const mismatches = (await client.query(
            `SELECT user_id, account_type, source_id, label, account_id, target_balance_paise, ledger_balance_paise
             FROM ledger_balance_check
             WHERE account_id IS NULL OR target_balance_paise <> ledger_balance_paise
             ORDER BY user_id, account_type, source_id`,
        )).rows;
        const unbalanced = (await client.query(
            `SELECT e.id, e.user_id, count(l.id) AS lines, coalesce(sum(l.amount_paise), 0) AS total
             FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id
             GROUP BY e.id
             HAVING count(l.id) < 2 OR coalesce(sum(l.amount_paise), 0) <> 0`,
        )).rows;
        const counts = (await client.query(
            `SELECT (SELECT count(*) FROM ledger_accounts) AS accounts,
                    (SELECT count(*) FROM journal_entries WHERE voided_at IS NULL) AS entries,
                    (SELECT count(*) FROM journal_entries WHERE voided_at IS NOT NULL) AS voided`,
        )).rows[0];
        console.log(`${counts.accounts} accounts, ${counts.entries} entries (${counts.voided} voided)`);

        for (const row of mismatches) {
            const ledger = row.account_id === null ? 'no ledger account' : `ledger ${row.ledger_balance_paise} paise`;
            console.log(`Mismatch: user ${row.user_id} ${row.account_type} ${row.source_id} (${row.label}): `
                + `stored ${row.target_balance_paise} paise, ${ledger}`);
        }
        for (const row of unbalanced) {
            console.log(`Unbalanced: entry ${row.id} of user ${row.user_id}: ${row.lines} lines, total ${row.total} paise`);
        }
        if (mismatches.length || unbalanced.length) {
            console.log(`Error: ${mismatches.length} balance mismatches, ${unbalanced.length} unbalanced entries`);
            process.exitCode = 1;
        } else {
            console.log('The ledger agrees with every stored balance, and every entry balances');
        }
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
    }
}

main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});

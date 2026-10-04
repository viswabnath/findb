#!/usr/bin/env node
/**
 * Applies the numbered SQL files in db/migrations/ that have not run yet, in order, each in its own
 * transaction, and records them in schema_migrations. The database and schema come from the
 * environment, exactly as for the app (lib/db.ts):
 *
 *   npm run migrate:test                       the test database (.env.test, schema balancetrack_test)
 *   node scripts/migrate.js --production       production (.env, schema public); take a backup first
 *   node scripts/migrate.js --status           list applied and pending migrations, change nothing
 *
 * Production needs --production on purpose, so it is never migrated by accident. Under
 * REQUIRE_TEST_SCHEMA=true only a *_test schema is accepted, like the app's pool.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
    const args = new Set(process.argv.slice(2));
    const schema = process.env.DB_SCHEMA || 'public';
    const isTestSchema = /_test$/.test(schema);

    if (process.env.REQUIRE_TEST_SCHEMA === 'true' && !isTestSchema) {
        throw new Error(`Refusing to migrate: REQUIRE_TEST_SCHEMA is set but the schema is "${schema}"`);
    }
    if (!isTestSchema && !args.has('--production') && !args.has('--status')) {
        throw new Error(`Refusing to migrate schema "${schema}" without --production (take a backup first: docs/backups.md)`);
    }

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
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )`);
        await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');

        const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(row => row.name));
        const files = fs.readdirSync(DIR).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
        const pending = files.filter(file => !applied.has(file));

        if (args.has('--status')) {
            for (const file of files) console.log(`${applied.has(file) ? 'applied' : 'pending'}  ${file}`);
            return;
        }
        if (pending.length === 0) {
            console.log('Nothing to apply: every migration has run');
            return;
        }
        for (const file of pending) {
            const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
            // One transaction per file: it applies completely or not at all (the ledger's balance
            // checks run at its commit)
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`Applied ${file}`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw new Error(`${file} failed and was rolled back: ${error.message}`, { cause: error });
            }
        }
    } finally {
        await client.end();
    }
}

main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});

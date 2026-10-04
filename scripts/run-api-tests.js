#!/usr/bin/env node
/**
 * Run the Jest suites, with the API suites going over HTTP to a real Next.js server.
 *
 *   node scripts/run-api-tests.js                 build Next.js, start it on port 3200 against the
 *                                                 balancetrack_test schema, and run every Jest project
 *   node scripts/run-api-tests.js tests/atomic-writes.test.js
 *                                                 only the named test files
 *   API_BASE_URL=http://localhost:3000 node scripts/run-api-tests.js
 *                                                 use an already running server (it must use the
 *                                                 balancetrack_test schema)
 *
 * The server's output goes to a log file named in the run's output, so a 500 can be traced.
 */
// The test database settings from .env.test, before anything starts or connects
const { useTestEnv } = require('./use-test-env');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.API_TEST_PORT || 3200);
const NEXT_BIN = path.join('node_modules', 'next', 'dist', 'bin', 'next');

/** The server settings every test server needs: test schema only, and no request limits */
const TEST_SERVER_ENV = { DB_SCHEMA: 'balancetrack_test', REQUIRE_TEST_SCHEMA: 'true', DISABLE_RATE_LIMIT: 'true' };

async function waitUntilUp(url, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // not listening yet
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Server at ${url} did not start within ${timeoutMs / 1000}s`);
}

function run(command, args, env) {
    return new Promise(resolve => {
        const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
        child.on('exit', code => resolve(code ?? 1));
    });
}

async function startServer() {
    // The test schema gets any migration not yet applied (db/migrations), as production will
    if (await run('node', ['scripts/migrate.js'], TEST_SERVER_ENV) !== 0) throw new Error('migrations failed');
    console.log('Building Next.js...');
    if (await run('node', [NEXT_BIN, 'build'], {}) !== 0) throw new Error('next build failed');
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'findb-api-')), 'server.log');
    const log = fs.openSync(logFile, 'a');
    // node directly (not npx), so kill() stops the server itself
    const server = spawn('node', [NEXT_BIN, 'start', '--port', String(PORT)], {
        cwd: ROOT, env: { ...process.env, ...TEST_SERVER_ENV }, stdio: ['ignore', log, log],
    });
    await waitUntilUp(`http://localhost:${PORT}/next-health`);
    console.log(`Next.js on http://localhost:${PORT} (server log: ${logFile})`);
    return server;
}

async function main() {
    console.log(useTestEnv()
        ? 'Using the separate test database from .env.test'
        : 'Warning: .env.test not found; tests use the balancetrack_test schema of the database in .env');
    let server = null;
    let baseUrl = process.env.API_BASE_URL;
    if (!baseUrl) {
        server = await startServer();
        baseUrl = `http://localhost:${PORT}`;
    }
    const files = process.argv.slice(2).filter(arg => /\.test\.[jt]s$/.test(arg));
    const code = await run('npx', ['jest', ...(files.length ? ['--runTestsByPath', ...files] : []), '--detectOpenHandles', '--forceExit'],
        { API_BASE_URL: baseUrl });
    if (server) server.kill();
    process.exit(code);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});

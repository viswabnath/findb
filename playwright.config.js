// @ts-check
const { defineConfig, devices } = require('@playwright/test');
// The separate test database from .env.test, when it is set up; the server below inherits it
require('./scripts/use-test-env');

const PORT = Number(process.env.E2E_PORT || 3100);

/**
 * End-to-end tests of real user flows against a production build of the app (next build, then
 * next start), using the isolated balancetrack_test schema, never production data (public).
 * Set E2E_BASE_URL to run them against an already running or deployed app instead.
 */
module.exports = defineConfig({
    testDir: './tests/e2e',
    // Flows share one database; run them one at a time like the Jest suites
    workers: 1,
    fullyParallel: false,
    // Each step round-trips to the remote database, so full flows take a while
    timeout: 180_000,
    expect: { timeout: 15_000 },
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    globalTeardown: './tests/e2e/global-teardown.js',
    use: {
        baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: process.env.E2E_BASE_URL ? undefined : {
        // Any migration not yet applied to the test schema runs first (scripts/migrate.js)
        command: `node scripts/migrate.js && npx next build && npx next start --port ${PORT}`,
        url: `http://localhost:${PORT}/next-health`,
        reuseExistingServer: false,
        timeout: 240_000,
        // Test schema only (the pool refuses any other), and no request limits
        env: {
            // Includes the .env.test connection settings loaded above
            .../** @type {Record<string, string>} */ (process.env),
            DB_SCHEMA: 'balancetrack_test',
            REQUIRE_TEST_SCHEMA: 'true',
            DISABLE_RATE_LIMIT: 'true',
        },
    },
});

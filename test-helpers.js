/**
 * Test Helper Utilities
 * Provides common functions for test setup, teardown, and data management
 */

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

// Use the same pool instance as the main application to avoid conflicts
let pool;
try {
    pool = require('./db');
} catch {
    // Fallback if db.js is not available
    const { Pool } = require('pg');
    pool = new Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'expense_tracker',
        password: process.env.DB_PASSWORD || '',
        port: process.env.DB_PORT || 5432,
        ssl: process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        ...(process.env.DB_SCHEMA && { options: `-c search_path=${process.env.DB_SCHEMA}` }),
        // Fail rather than hang if the database stalls (a reset once hung for hours)
        connectionTimeoutMillis: 10000,
        query_timeout: 60000
    });
}

/**
 * Clear all test data from the database
 */
async function clearTestData() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Never delete outside a test schema (production data lives in public)
        const { rows } = await client.query('SELECT current_schema() AS schema');
        if (!/_test$/.test(rows[0].schema || '')) {
            throw new Error(`Refusing to clear data: current schema is ${rows[0].schema}, expected a *_test schema`);
        }

        // Delete in order to respect foreign key constraints
        await client.query('DELETE FROM activity_log');
        await client.query('DELETE FROM expenses');
        await client.query('DELETE FROM income_entries');
        await client.query('DELETE FROM cash_balance');
        await client.query('DELETE FROM credit_cards');
        await client.query('DELETE FROM banks');
        // The ledger tables (ledger_accounts, journal_entries, journal_lines) go with their user
        await client.query('DELETE FROM users');

        // Reset sequences
        await client.query('ALTER SEQUENCE users_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE banks_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE credit_cards_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE income_entries_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE expenses_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE cash_balance_id_seq RESTART WITH 1');
        await client.query('ALTER SEQUENCE activity_log_id_seq RESTART WITH 1');

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Create a test user
 */
async function createTestUser(userData = {}) {
    const {
        username = 'testuser',
        password = 'TestPass123&',
        name = 'Test User',
        email = 'test@example.com',
        securityQuestion = 'What is your pet name?',
        securityAnswer = 'fluffy',
        trackingOption = 'both'
    } = userData;

    const client = await pool.connect();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const hashedSecurityAnswer = await bcrypt.hash(securityAnswer, 10);

        const result = await client.query(
            `INSERT INTO users (username, password_hash, name, email, security_question, security_answer_hash, tracking_option) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [username, hashedPassword, name, email, securityQuestion, hashedSecurityAnswer, trackingOption]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Create a test bank
 */
async function createTestBank(userId, bankData = {}) {
    const {
        name = 'Test Bank',
        balance = 1000
    } = bankData;

    const client = await pool.connect();

    try {
        const result = await client.query(
            'INSERT INTO banks (user_id, name, initial_balance, current_balance) VALUES ($1, $2, $3, $3) RETURNING *',
            [userId, name, balance]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Create a test credit card
 */
async function createTestCreditCard(userId, cardData = {}) {
    const {
        name = 'Test Credit Card',
        creditLimit = 5000
    } = cardData;

    const client = await pool.connect();

    try {
        const result = await client.query(
            'INSERT INTO credit_cards (user_id, name, credit_limit) VALUES ($1, $2, $3) RETURNING *',
            [userId, name, creditLimit]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Create a test cash balance entry
 */
async function createTestCashBalance(userId, amount = 500) {
    const client = await pool.connect();

    try {
        const result = await client.query(
            'INSERT INTO cash_balance (user_id, balance, initial_balance) VALUES ($1, $2, $2) RETURNING *',
            [userId, amount]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Setup a complete test environment with user, bank, credit card, and cash balance
 * For local development, this will reuse existing data if available
 */
async function setupTestEnvironment(customData = {}) {
    // Check if test user already exists
    let user;
    try {
        const existingUser = await query('SELECT * FROM users WHERE username = $1', ['testuser']);
        if (existingUser.rows.length > 0) {
            user = existingUser.rows[0];
            console.log('Reusing existing test user:', user.username);
        }
    } catch {
        // User doesn't exist, we'll create one
    }

    // Only clear and recreate if no user exists
    if (!user) {
        console.log('Creating fresh test environment...');
        await clearTestData();
        user = await createTestUser(customData.user);
    }

    // Check for existing bank, credit card, and cash balance
    let bank, creditCard, cashBalance;

    try {
        const existingBank = await query('SELECT * FROM banks WHERE user_id = $1 LIMIT 1', [user.id]);
        if (existingBank.rows.length > 0) {
            bank = existingBank.rows[0];
        } else {
            bank = await createTestBank(user.id, customData.bank);
        }

        const existingCreditCard = await query('SELECT * FROM credit_cards WHERE user_id = $1 LIMIT 1', [user.id]);
        if (existingCreditCard.rows.length > 0) {
            creditCard = existingCreditCard.rows[0];
        } else {
            creditCard = await createTestCreditCard(user.id, customData.creditCard);
        }

        const existingCashBalance = await query('SELECT * FROM cash_balance WHERE user_id = $1 LIMIT 1', [user.id]);
        if (existingCashBalance.rows.length > 0) {
            cashBalance = existingCashBalance.rows[0];
        } else {
            cashBalance = await createTestCashBalance(user.id, customData.cashAmount);
        }
    } catch {
        // If any issues, create fresh data
        bank = await createTestBank(user.id, customData.bank);
        creditCard = await createTestCreditCard(user.id, customData.creditCard);
        cashBalance = await createTestCashBalance(user.id, customData.cashAmount);
    }

    return {
        user,
        bank,
        creditCard,
        cashBalance
    };
}

/**
 * Get the database pool instance (DO NOT CLOSE THIS IN TESTS)
 */
function getPool() {
    return pool;
}

/**
 * Delete a single test user and all of their data by username
 */
async function deleteTestUser(username) {
    const { rows } = await pool.query('SELECT current_schema() AS schema');
    if (!/_test$/.test(rows[0].schema || '')) {
        throw new Error(`Refusing to delete user: current schema is ${rows[0].schema}, expected a *_test schema`);
    }
    const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return;
    const userId = result.rows[0].id;
    for (const table of ['activity_log', 'expenses', 'income_entries', 'cash_balance', 'credit_cards', 'banks']) {
        await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    // The user's ledger goes with them (ON DELETE CASCADE)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * Execute a query using the shared pool
 */
async function query(text, params) {
    return pool.query(text, params);
}

/**
 * Clean up database connections (only call this in the main cleanup)
 */
async function closePool() {
    if (pool && !pool.ended && typeof pool.end === 'function') {
        try {
            await pool.end();
        } catch {
            // Ignore errors if pool is already closed
        }
    }
}

module.exports = {
    clearTestData,
    createTestUser,
    createTestBank,
    createTestCreditCard,
    createTestCashBalance,
    setupTestEnvironment,
    deleteTestUser,
    getPool,
    query,
    closePool
};

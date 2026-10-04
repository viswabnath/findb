// @ts-check
/**
 * Shared steps for the end-to-end flows. Selectors use the ids and data-action attributes
 * the app already has, so the same tests can later run against the Next.js version
 * once its screens expose the same hooks.
 */
const { expect } = require('@playwright/test');
// The app's own TOTP code (Playwright loads TypeScript), to answer two-factor login like an authenticator app
const { totpCode, totpStep } = require('../../lib/totp.ts');

// Test users all start with this prefix so global-teardown can remove them
const E2E_PREFIX = 'e2e_';

function uniqueUser() {
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    return {
        name: 'E2E Tester',
        username: `${E2E_PREFIX}${id}`,
        email: `${E2E_PREFIX}${id}@example.test`,
        password: 'E2e_pass1',
        securityQuestion: 'pet',
        securityAnswer: 'rex',
    };
}

/** Format a number the way the app displays money: ₹ with Indian grouping and 2 decimals */
function rupees(amount) {
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today() {
    return new Date().toISOString().split('T')[0];
}

/**
 * The next code for a user, as their authenticator app would show it. A code works once, so after
 * one is used the next login needs a later 30-second step: one step ahead is accepted, beyond that
 * this waits for the clock.
 */
async function nextCode(user) {
    const step = Math.max(totpStep(), (user.lastStep ?? -1) + 1);
    while (step > totpStep() + 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    user.lastStep = step;
    return totpCode(user.totpSecret, step);
}

/**
 * Two-factor setup, as a new account sees it after registering: read the key shown for typing by
 * hand, enter a code from it, then confirm the recovery codes are saved. Keeps the secret and one
 * recovery code on `user` for later logins.
 */
async function setUpTwoFactor(page, user) {
    const key = page.locator('#two-factor-secret');
    await expect(key).toBeVisible();
    user.totpSecret = await key.getAttribute('data-secret');
    await page.locator('#two-factor-setup-code').fill(await nextCode(user));
    await page.locator('[data-action="confirmTwoFactor"]').click();
    await expect(page.locator('#recovery-codes li')).toHaveCount(10);
    user.recoveryCodes = await page.locator('#recovery-codes code').allTextContents();
    await page.locator('#recovery-codes-saved').check();
    await page.locator('[data-action="finishTwoFactor"]').click();
}

async function register(page, user) {
    await page.goto('/login');
    await page.locator('[data-action="showRegister"]').click();
    await page.locator('#register-name').fill(user.name);
    await page.locator('#register-username').fill(user.username);
    await page.locator('#register-email').fill(user.email);
    await page.locator('#register-password').fill(user.password);
    await page.locator('#register-confirm-password').fill(user.password);
    await page.locator('#register-security-question').selectOption(user.securityQuestion);
    await page.locator('#register-security-answer').fill(user.securityAnswer);
    await page.locator('[data-action="register"]').click();
    await setUpTwoFactor(page, user);
    await expect(page.locator('#welcome-section')).toBeVisible();
}

async function chooseTracking(page, option) {
    await page.locator(`[data-action="setTrackingOption"][data-option="${option}"]`).click();
    await expect(page.locator('#main-app')).toBeVisible();
}

/** Both steps of a login: the password, then the code from the user's authenticator secret */
async function login(page, user, password = user.password) {
    await page.goto('/login');
    await page.locator('#login-username').fill(user.username);
    await page.locator('#login-password').fill(password);
    await page.locator('[data-action="login"]').click();
    await page.locator('#two-factor-code').fill(await nextCode(user));
    await page.locator('[data-action="verifyTwoFactor"]').click();
    await expect(page.locator('#main-app')).toBeVisible();
}

async function logout(page) {
    await page.locator('#nav-bar [data-action="logout"]').click();
    await page.locator('[data-action="confirm-logout"]').click();
    await expect(page.locator('#login-form')).toBeVisible();
}

// GET requests each section makes when shown. Waiting on them is required: switching to
// Transactions rebuilds the account dropdowns, resetting any selection made before the
// rebuild lands. (waitForLoadState('networkidle') does not help: this single-page app
// never navigates, so that state was reached long ago and the wait returns at once.)
// Setup is a Next.js page (a full page load that fetches its data every time); the other
// sections are still in the legacy app.
const SECTION_REQUESTS = {
    setup: ['/api/banks', '/api/credit-cards', '/api/cash-balance'],
    transactions: ['/api/banks', '/api/credit-cards', '/api/income', '/api/expenses'],
    summary: ['/api/monthly-summary'],
    activity: ['/api/activity'],
};

async function showSection(page, section) {
    const loaded = (SECTION_REQUESTS[section] || []).map(path => page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === path));
    await page.locator(`#nav-bar [data-action="showSection"][data-section="${section}"]`).first().click();
    await expect(page.locator(`#${section}-section`)).toBeVisible();
    await Promise.all(loaded);
}

async function addBank(page, name, balance) {
    await page.locator('#bank-name').fill(name);
    await page.locator('#bank-balance').fill(String(balance));
    await page.locator('[data-action="addBank"]').click();
    await expect(page.locator('#banks-list tr', { hasText: name.toUpperCase() })).toBeVisible();
}

/**
 * Pick an account in a transaction form dropdown (call after showSection, which waits
 * for the dropdown rebuild), then confirm the choice stuck.
 */
async function selectAccount(page, selectId, label) {
    const select = page.locator(`#${selectId}`);
    await expect(select.locator('option', { hasText: label })).toHaveCount(1);
    await select.selectOption({ label });
    const value = await select.inputValue();
    expect(value).not.toBe('cash');
    await expect(select).toHaveValue(value);
}

/** Row in the Setup banks table for this bank */
function bankRow(page, name) {
    return page.locator('#banks-list tr', { hasText: name.toUpperCase() });
}

function cardRow(page, name) {
    return page.locator('#credit-cards-list tr', { hasText: name.toUpperCase() });
}

module.exports = {
    E2E_PREFIX,
    uniqueUser,
    rupees,
    today,
    register,
    setUpTwoFactor,
    nextCode,
    chooseTracking,
    login,
    logout,
    showSection,
    addBank,
    selectAccount,
    bankRow,
    cardRow,
};

// @ts-check
/**
 * Two-factor login and the Settings screen (docs/security.md), in the browser: a recovery code
 * logs in once, the Settings screen lists this device and the login history, and "Sign out
 * everywhere" ends the session.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, login, logout } = require('./helpers');

test('a recovery code logs in when the phone is lost', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await logout(page);

    await page.locator('#login-username').fill(user.username);
    await page.locator('#login-password').fill(user.password);
    await page.locator('[data-action="login"]').click();
    await page.locator('[data-action="useRecoveryCode"]').click();
    await page.locator('#recovery-code').fill(user.recoveryCodes[0]);
    await page.locator('[data-action="verifyTwoFactor"]').click();
    await expect(page.locator('#main-app')).toBeVisible();
});

test('Settings lists this device and the logins, and signs out everywhere', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');

    await page.locator('#nav-bar [data-action="showSection"][data-section="settings"]').click();
    await expect(page.locator('#settings-section')).toBeVisible();
    await expect(page.locator('#two-factor-status')).toContainText('On since');
    await expect(page.locator('#recovery-codes-left')).toContainText('10 of 10');
    await expect(page.locator('#sessions-list li', { hasText: 'This device' })).toHaveCount(1);
    await expect(page.locator('#login-history')).toContainText('Two-factor login turned on');

    await page.locator('[data-action="signOutEverywhere"]').click();
    await expect(page.locator('#login-form')).toBeVisible();
    expect((await page.request.get('/api/banks')).status()).toBe(401);
});

test('a password alone opens nothing', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await logout(page);

    await page.locator('#login-username').fill(user.username);
    await page.locator('#login-password').fill(user.password);
    await page.locator('[data-action="login"]').click();
    await expect(page.locator('#two-factor-code')).toBeVisible();
    expect((await page.request.get('/api/banks')).status()).toBe(401);
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
});

test('sign-up shows the privacy notice, and withdrawing consent locks the app until agreeing again', async ({ page }) => {
    const user = uniqueUser();
    await page.goto('/register');
    await expect(page.locator('#register-privacy-notice')).toContainText('Your rights');
    await register(page, user);
    await chooseTracking(page, 'both');

    await page.locator('#nav-bar [data-action="showSection"][data-section="settings"]').click();
    await expect(page.locator('#consent-status')).toContainText('Consent given');
    await expect(page.locator('#my-data-list li[data-table="users"]')).toContainText('1 record');
    await page.locator('[data-action="withdrawConsent"]').click();
    await expect(page.locator('#withdraw-consent-warning')).toBeVisible();
    await page.locator('[data-action="confirmWithdrawConsent"]').click();
    await expect(page.locator('#login-form')).toBeVisible();

    await login(page, user);
    // login() waits for the app frame; the consent screen shows inside it instead of the screen
    await expect(page.locator('#consent-section')).toBeVisible();
    await expect(page.locator('[data-action="giveConsent"]')).toBeDisabled();
    await page.locator('#consent-agree').check();
    await page.locator('[data-action="giveConsent"]').click();
    await expect(page.locator('#setup-section')).toBeVisible();
    await expect(page.locator('#consent-section')).toHaveCount(0);
});

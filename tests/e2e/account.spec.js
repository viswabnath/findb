// @ts-check
/**
 * Your data (Settings, v2 Phase 5): the copy of everything downloads, and the account is deleted
 * with the password, a code and DELETE, after which signing in again fails.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank, nextCode } = require('./helpers');

test('download a copy, then delete the account', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Leaving Bank', 1000);
    await page.goto('/settings');

    const download = page.waitForEvent('download');
    await page.locator('[data-action="exportJson"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^findb-data-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(require('node:fs').readFileSync(await file.path(), 'utf8'));
    expect(data.tables.banks.map(bank => bank.name)).toEqual(['E2E LEAVING BANK']);

    await page.locator('[data-action="deleteAccount"]').click();
    await page.locator('#delete-password').fill(user.password);
    await page.locator('#delete-code').fill(await nextCode(user));
    await expect(page.locator('[data-action="confirmDeleteAccount"]')).toBeDisabled();
    await page.locator('#delete-confirm').fill('DELETE');
    await page.locator('[data-action="confirmDeleteAccount"]').click();
    await expect(page).toHaveURL(/\/$/);

    const login = await page.request.post('/api/login', { data: { username: user.username, password: user.password } });
    expect(login.status()).toBe(400);
});

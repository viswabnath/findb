// @ts-check
/**
 * The phone app offline (v2 Phase 5): an entry added with Quick add while offline is kept on the
 * phone, and sent once the connection is back.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('an entry added offline is kept on the phone and sent when back online', async ({ page, context }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Offline Bank', 5000);
    await page.goto('/transactions');

    // Opened once online, quick add keeps the accounts and categories for offline use
    await page.locator('[data-action="quickAdd"]').first().click();
    await expect(page.locator('#quick-add-modal .chip').first()).toBeVisible();
    await page.locator('[data-action="close-quick-add"]').first().click();

    await context.setOffline(true);
    await expect(page.locator('#offline-bar')).toContainText('You are offline');
    await page.locator('[data-action="quickAdd"]').first().click();
    await page.locator('#quick-amount').fill('85');
    await page.locator('#quick-add-modal .chip').first().click();
    await page.locator('[data-action="saveQuickAdd"]').click();
    await expect(toast(page, 'No connection: ₹85.00')).toBeVisible();
    await expect(page.locator('#offline-bar')).toContainText('1 entry is kept on this phone');

    await context.setOffline(false);
    await expect(toast(page, '1 entry saved while offline was sent.')).toBeVisible();
    await expect(page.locator('#offline-bar')).toHaveCount(0);
    const bank = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'bank');
    expect(bank.balance).toBe('4915.00');
});

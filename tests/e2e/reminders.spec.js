// @ts-check
/**
 * Reminders (Settings, v2 Phase 5): the card explains what a reminder holds. The test server has no
 * push keys, so it says reminders are not available here (production has them).
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking } = require('./helpers');

test('Settings explains reminders, and says when this server cannot send them', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await page.goto('/settings');
    const card = page.locator('#reminders-section');
    await expect(card).toContainText('names only, never amounts');
    await expect(card.locator('#reminders-unavailable')).toBeVisible();
});

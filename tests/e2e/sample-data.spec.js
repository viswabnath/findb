// @ts-check
/**
 * Sample data and the next step: a new account is offered sample data, explores it with the
 * banner on every screen, and clears it back to a fresh start.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, showSection } = require('./helpers');

test('try sample data, see it marked on every screen, then clear it', async ({ page }) => {
    test.setTimeout(120000);
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await expect(page.locator('#next-step')).toHaveAttribute('data-step', 'start');

    await page.locator('[data-action="loadSample"]').click();
    await expect(page.locator('#sample-banner')).toBeVisible({ timeout: 60000 });
    // The banner says what to do, so the next-step card steps aside
    await expect(page.locator('#next-step')).toHaveCount(0);
    await expect(page.locator('#banks-list')).toContainText('HDFC SAVINGS (SAMPLE)');

    await showSection(page, 'transactions');
    await expect(page.locator('#sample-banner')).toBeVisible();
    await expect(page.locator('#transactions-section')).toContainText('Salary');

    await page.locator('#sample-banner [data-action="clearSample"]').click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.locator('#next-step')).toHaveAttribute('data-step', 'start');
    await expect(page.locator('#sample-banner')).toHaveCount(0);
    await expect(page.locator('#banks-list')).not.toContainText('SAMPLE');
});

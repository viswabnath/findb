// @ts-check
/**
 * The design system: the light or dark choice is kept across pages, and the phone layout shows
 * whole tab labels with Settings in the top bar.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking } = require('./helpers');

test('a dark choice in Settings is applied at once and on every later page', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await page.goto('/settings');
    await page.locator('[data-theme-option="dark"]').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/setup');
    // Rendered dark by the server, before any script runs
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(7, 19, 14)');

    await page.goto('/settings');
    await page.locator('[data-theme-option="system"]').check();
    await page.goto('/setup');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('on a phone, five tabs show whole labels and Settings is in the top bar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    const tabs = page.locator('.tabbar a');
    await expect(tabs).toHaveCount(5);
    for (const tab of await tabs.all()) {
        expect(await tab.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.locator('.app-topbar [data-section="settings"]').click();
    await expect(page.locator('#settings-section')).toBeVisible();
});

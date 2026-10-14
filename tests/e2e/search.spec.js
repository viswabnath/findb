// @ts-check
/**
 * Search (/search, v2 Phase 2): words and totals, a matching category as a filter, the filters
 * panel, the address keeping the search, and saved searches.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const YEAR = new Date().getFullYear() - 1;

test('search, filter, keep in the address and save', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Search Bank', 50000);
    const accounts = await (await page.request.get('/api/accounts')).json();
    const bank = accounts.find(account => account.type === 'bank');
    const categories = await (await page.request.get('/api/categories')).json();
    const id = name => categories.find(category => category.name === name).id;
    const saved = await page.request.post('/api/entries/bulk', { data: { entries: [
        { type: 'expense', date: `${YEAR}-03-02`, description: 'Swiggy biryani', amount: '450', accountId: bank.id, categoryId: id('Restaurants and food delivery') },
        { type: 'expense', date: `${YEAR}-03-09`, description: 'Swiggy pizza', amount: '620', accountId: bank.id, categoryId: id('Restaurants and food delivery') },
        { type: 'expense', date: `${YEAR}-04-01`, description: 'Rent April', amount: '22000', accountId: bank.id, categoryId: id('Rent') },
    ] } });
    expect(saved.ok()).toBe(true);

    await page.locator('#nav-bar [data-section="search"]').click();
    await expect(page).toHaveURL(/\/search$/);
    await page.locator('#search-q').fill('swiggy');
    await page.locator('[data-action="runSearch"]').click();
    await expect(page.locator('#search-summary')).toHaveText('2 entries. ₹1,070.00 spent.');
    await expect(page.locator('#search-list li')).toHaveCount(2);
    await expect(page.locator('#search-list li').first()).toContainText('Swiggy pizza');
    await expect(page).toHaveURL(/\/search\?q=swiggy$/);

    // Narrow with the filters panel
    await page.locator('.search-filters summary').click();
    await page.locator('#search-min').fill('500');
    await page.locator('[data-action="applyFilters"]').click();
    await expect(page.locator('#search-summary')).toHaveText('1 entry. ₹620.00 spent.');

    await page.locator('[data-action="saveSearch"]').click();
    await page.locator('#search-save-name').fill('Big Swiggy');
    await page.locator('[data-action="confirmSaveSearch"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Saved as Big Swiggy' })).toBeVisible();

    // A search in the address runs on arrival; a matching category becomes a filter
    await page.goto('/search?q=rent');
    await expect(page.locator('#search-summary')).toHaveText('1 entry. ₹22,000.00 spent.');
    await page.locator('#search-names .chip', { hasText: /^Category: Rent$/ }).click();
    await expect(page).toHaveURL(new RegExp(`categoryId=${id('Rent')}`));
    await expect(page.locator('#search-q')).toHaveValue('');
    await expect(page.locator('#search-list li')).toHaveCount(1);

    // The saved search runs in one tap, and can be removed
    await page.locator('#saved-searches .chip[data-saved="Big Swiggy"]').click();
    await expect(page.locator('#search-summary')).toHaveText('1 entry. ₹620.00 spent.');
    await page.locator('#saved-searches [aria-label="Remove saved search Big Swiggy"]').click();
    await expect(page.locator('#saved-searches')).toHaveCount(0);
});

test('search is in the top bar on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await page.locator('.app-topbar [data-section="search"]').click();
    await expect(page.locator('#search-section')).toBeVisible();
    await expect(page.locator('.tabbar a')).toHaveCount(5);
});

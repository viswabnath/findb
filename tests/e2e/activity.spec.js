// @ts-check
/**
 * Activity moved to Next.js (/activity) in N2, the last legacy screen; "/" is Next.js too.
 * flows.spec.js checks that changes appear in the feed and the CSV export; this covers the
 * rest: labels, paging past the first page, filters and Clear, old links, and the CSP.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, showSection } = require('./helpers');

async function newUser(page, tracking = 'both') {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, tracking);
    await expect(page.locator('#setup-section')).toBeVisible();
    return user;
}

const feed = page => page.locator('#activity-list');

test('/activity without a session goes to /login', async ({ page }) => {
    await page.goto('/activity');
    await expect(page).toHaveURL(/\/login$/);
});

test('old links to the single-page app open the matching screen', async ({ page }) => {
    await newUser(page);
    await page.goto('/?section=transactions');
    await expect(page).toHaveURL(/\/transactions$/);
    await page.goto('/?section=activity');
    await expect(page).toHaveURL(/\/activity$/);
    await page.goto('/?section=unknown');
    await expect(page).toHaveURL(/\/setup$/);

    // "/" itself is the website, which offers a way back into the app
    await page.goto('/');
    await page.locator('.header-actions a', { hasText: 'Open FinDB' }).click();
    await expect(page).toHaveURL(/\/setup$/);
});

test('activity renders under the nonce CSP without console errors, with labelled entries', async ({ page }) => {
    await newUser(page);
    // A bank through the API (same session), so the feed has a known entry
    expect((await page.request.post('/api/banks', { data: { name: '<i>Hdfc</i>', initialBalance: 500 } })).ok()).toBe(true);

    const problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI || 'inline'}`)));

    await showSection(page, 'activity');
    await expect(page).toHaveURL(/\/activity$/);
    const response = await page.reload();
    expect(response?.headers()['content-security-policy'] || '').toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);

    const item = page.locator('.activity-item.action-bank-add');
    await expect(item.locator('.activity-action')).toHaveText('Bank Added');
    await expect(item.locator('.activity-description')).toContainText('Added bank account: <I>HDFC</I>');
    await expect(item.locator('i')).toHaveCount(0);
    await expect(item.locator('.activity-amount')).toHaveText('₹500.00');
    expect(problems).toEqual([]);
});

test('every entry is reachable: the feed pages through the server, not just the latest 20', async ({ page }) => {
    await newUser(page);
    // 23 entries: more than the API's old single page of 20
    for (let index = 1; index <= 23; index++) {
        const created = await page.request.post('/api/income', {
            data: { source: `Gig ${index}`, amount: index, creditedToType: 'cash', creditedToId: null, date: '2026-01-15' },
        });
        expect(created.ok()).toBe(true);
    }

    await showSection(page, 'activity');
    // Plus the welcome step's choice of what to track
    await expect(page.locator('#activity-section .card-head .meta')).toHaveText('24 changes');
    await expect(page.locator('.activity-item')).toHaveCount(10);
    await expect(page.locator('.pagination-btn.active')).toHaveText('1');

    await page.locator('.pagination-btn', { hasText: '3' }).click();
    await expect(page.locator('.pagination-btn.active')).toHaveText('3');
    await expect(page.locator('.activity-item')).toHaveCount(4);
    // The oldest entries, which the legacy feed could never show
    await expect(feed(page)).toContainText('Added income: Gig 1');
    await expect(page.locator('.pagination-btn', { hasText: 'Next' })).toHaveCount(0);
});

test('filters: month needs a year, an empty month says so, and Clear shows everything again', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'activity');
    await expect(page.locator('#activity-month')).toBeDisabled();

    const lastYear = String(new Date().getFullYear() - 1);
    await page.locator('#activity-year').selectOption(lastYear);
    await expect(page.locator('#activity-month')).toBeEnabled();
    await page.locator('#activity-month').selectOption('1');
    await page.locator('[data-action="filterActivity"]').click();
    await expect(feed(page)).toHaveText('No activities found');

    // A new account's only entry so far is none; add one this year, then Clear brings it back
    expect((await page.request.post('/api/banks', { data: { name: 'Clear Bank', initialBalance: 1 } })).ok()).toBe(true);
    await page.locator('[data-action="clearActivityFilters"]').click();
    await expect(page.locator('#activity-year')).toHaveValue('');
    await expect(feed(page)).toContainText('Added bank account: CLEAR BANK');
});

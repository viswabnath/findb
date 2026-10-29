// @ts-check
/**
 * Credit cards (/cards, v2 Phase 4): reached from Accounts; the card's statement days and rate set,
 * the bank's statement recorded, and what paying only the minimum leaves carried.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });
const india = new Date(Date.now() + 330 * 60_000);
const daysAgo = n => new Date(india.getTime() - n * 86_400_000).toISOString().slice(0, 10);
// The billing day of the statement recorded below, so it is the card's latest
const BILLING = String(Number(daysAgo(20).slice(8)));
const DUE_DAY = BILLING === '25' ? '26' : '25';

test('a card: statement days and rate, the bank statement, and the minimum paid', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Card Bank', 100000);
    const bank = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'bank');
    expect((await page.request.post('/api/credit-cards', { data: { name: 'E2E Card', creditLimit: 100000 } })).ok()).toBe(true);
    const card = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'credit_card');
    expect((await page.request.post('/api/entries', { data: { type: 'expense', description: 'Laptop', amount: 40000, accountId: card.id, date: daysAgo(25) } })).ok()).toBe(true);

    await page.goto('/setup');
    await page.locator('#cards-link').click();
    const box = page.locator('[data-card="E2E CARD"]');
    await expect(box.locator('.card-owed')).toHaveText('Owed ₹40,000.00');
    await expect(box.locator('.notice')).toContainText('Add the billing and due days');

    await box.locator('.card-billing-day').fill(BILLING);
    await box.locator('.card-due-day').fill(DUE_DAY);
    await box.locator('.card-rate-input').fill('3.5');
    await box.locator('select').selectOption('per100month');
    await box.locator('[data-action="saveCardTerms"]').click();
    await expect(toast(page, 'E2E CARD updated')).toBeVisible();
    await expect(box.locator('.card-rate')).toContainText('42% a year (₹3.5 per ₹100 a month), about 51.11% a year as charged');

    await box.locator('[data-action="recordStatement"]').click();
    await page.locator('#statement-date').fill(daysAgo(20));
    await page.locator('#statement-due').fill(daysAgo(2));
    await page.locator('#statement-amount').fill('40000');
    await page.locator('#statement-minimum').fill('2000');
    await page.locator('[data-action="saveStatement"]').click();
    await expect(toast(page, 'statement of E2E CARD recorded')).toBeVisible();
    await expect(box.locator('.card-due')).toContainText('₹40,000.00 due by');
    await expect(box.locator('.card-due .tag').first()).toHaveText('Not paid yet');
    await expect(box.locator('[data-warning="overdue"]')).toBeVisible();

    expect((await page.request.post('/api/entries', { data: { type: 'transfer', description: 'Card bill', amount: 2000, accountId: bank.id, toAccountId: card.id, date: daysAgo(5) } })).ok()).toBe(true);
    await page.reload();
    await expect(box.locator('.card-due .tag').first()).toHaveText('Minimum paid');
    await expect(box.locator('[data-warning="carried"]')).toContainText('₹38,000.00 was carried past the due date');
    await expect(box.locator('[data-warning="carried"]')).toContainText('about ₹1,330.00 a month');
});

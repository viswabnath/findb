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

test('two cards share a limit: what is left on one falls as the other is used', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    for (const name of ['E2E Primary', 'E2E Addon']) {
        expect((await page.request.post('/api/credit-cards', { data: { name, creditLimit: 100000 } })).ok()).toBe(true);
    }
    const primary = (await (await page.request.get('/api/accounts')).json()).find(account => account.name === 'E2E PRIMARY');
    expect((await page.request.post('/api/entries', { data: { type: 'expense', description: 'Phone', amount: 30000, accountId: primary.id, date: daysAgo(1) } })).ok()).toBe(true);

    await page.goto('/cards');
    await page.locator('#line-name').fill('HDFC cards');
    await page.locator('#line-limit').fill('50000');
    await page.locator('[data-line-card="E2E PRIMARY"]').click();
    await page.locator('[data-line-card="E2E ADDON"]').click();
    await page.locator('[data-action="addLine"]').click();
    await expect(toast(page, 'HDFC cards added')).toBeVisible();
    await expect(page.locator('[data-line="HDFC cards"]')).toContainText('₹30,000.00 owed of ₹50,000.00 · ₹20,000.00 left');
    await expect(page.locator('[data-card="E2E ADDON"] .card-line')).toContainText('Shares HDFC cards: ₹20,000.00 left of ₹50,000.00');
    await expect(page.locator('[data-card="E2E ADDON"] .loan-facts')).toContainText('₹20,000.00 left of ₹1,00,000.00');
});

test('a purchase on the card turned into EMIs blocks part of its limit', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    expect((await page.request.post('/api/credit-cards', { data: { name: 'E2E Emi Card', creditLimit: 100000 } })).ok()).toBe(true);
    const card = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'credit_card');
    expect((await page.request.post('/api/entries', { data: { type: 'expense', description: 'Fridge', amount: 45000, accountId: card.id, date: daysAgo(2) } })).ok()).toBe(true);

    await page.goto('/loans');
    await page.locator('[data-status="new"]').click();
    await page.locator('#loan-name').fill('Fridge EMI');
    await page.locator('#loan-kind').selectOption('card_emi');
    await expect(page.locator('#loan-into')).toHaveCount(0);
    await page.locator('#loan-card').selectOption(String(card.id));
    await page.locator('#loan-principal').fill('45000');
    await page.locator('#loan-rate').fill('0');
    await page.locator('#loan-months').fill('9');
    await page.locator('#loan-disbursed').fill(daysAgo(1));
    await page.locator('[data-action="addLoan"]').click();
    await expect(toast(page, 'Fridge EMI added')).toBeVisible();
    await expect(page.locator('.loan-on-card')).toContainText('On E2E EMI CARD: EMIs charged to the card, ₹45,000.00 of its limit blocked');

    await page.goto('/cards');
    const box = page.locator('[data-card="E2E EMI CARD"]');
    await expect(box.locator('.card-owed')).toHaveText('Owed ₹0.00');
    await expect(box.locator('.card-blocked')).toContainText('block ₹45,000.00 of its limit');
    await expect(box.locator('.loan-facts')).toContainText('₹55,000.00 left of ₹1,00,000.00');
});

test('rewards: points earned with their value and expiry, cashback, and which card gives back most', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    for (const name of ['E2E Travel', 'E2E Shop']) {
        expect((await page.request.post('/api/credit-cards', { data: { name, creditLimit: 100000 } })).ok()).toBe(true);
    }
    const accounts = await (await page.request.get('/api/accounts')).json();
    for (const [name, amount] of [['E2E TRAVEL', 10000], ['E2E SHOP', 20000]]) {
        const card = accounts.find(account => account.name === name);
        expect((await page.request.post('/api/entries', { data: { type: 'expense', description: 'Spend', amount, accountId: card.id, date: daysAgo(3) } })).ok()).toBe(true);
    }

    await page.goto('/cards');
    const travel = page.locator('[data-card="E2E TRAVEL"]');
    await travel.locator('.point-value').fill('0.5');
    await travel.locator('[data-action="savePointValue"]').click();
    await expect(toast(page, 'E2E TRAVEL updated')).toBeVisible();
    await travel.locator('[data-action="recordReward"]').click();
    await page.locator('#reward-points').fill('1000');
    await page.locator('#reward-expires').fill(new Date(india.getTime() + 40 * 86_400_000).toISOString().slice(0, 10));
    await page.locator('[data-action="saveReward"]').click();
    await expect(toast(page, 'Recorded on E2E TRAVEL')).toBeVisible();
    await expect(travel.locator('.reward-points')).toHaveText('1000 points, worth about ₹500.00');
    await expect(travel.locator('[data-warning="points"]')).toContainText('1000 points expire on');

    const shop = page.locator('[data-card="E2E SHOP"]');
    await shop.locator('[data-action="recordReward"]').click();
    await page.locator('#reward-kind').selectOption('cashback');
    await page.locator('#reward-amount').fill('200');
    await page.locator('[data-action="saveReward"]').click();
    await expect(toast(page, 'Recorded on E2E SHOP')).toBeVisible();
    await expect(shop.locator('.reward-cashback')).toContainText('₹200.00');

    // 500 back on 10,000 (5%), 200 back on 20,000 (1%)
    await expect(page.locator('#card-compare li').first()).toHaveAttribute('data-compare', 'E2E TRAVEL');
    await expect(page.locator('[data-compare="E2E TRAVEL"]')).toContainText('5% back: ₹500.00 on ₹10,000.00 spent');
    await expect(page.locator('[data-compare="E2E SHOP"]')).toContainText('1% back: ₹200.00 on ₹20,000.00 spent');
});

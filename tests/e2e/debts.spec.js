// @ts-check
/**
 * Debt review (/debts, v2 Phase 3): reached from People; debts ranked by their true yearly cost,
 * the warning about paying only a card's minimum, and the payoff simulator.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank, today } = require('./helpers');

test('debts ranked, the minimum-only warning, and what an extra amount saves', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Debt Bank', 100000);
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    const bank = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'bank');
    const card = await (await page.request.post('/api/credit-cards', { data: { name: 'E2E Card', creditLimit: 100000 } })).json();
    expect((await page.request.post('/api/expenses', { data: { title: 'Laptop', amount: 60000, paymentMethod: 'credit_card', paymentSourceId: card.id, date: today() } })).ok()).toBe(true);
    expect((await page.request.post('/api/loans', { data: {
        name: 'Bike loan', kind: 'vehicle', rateType: 'reducing', principal: '50000', interestRate: '11', months: 24, disbursedOn: today(), accountId: bank.id,
    } })).ok()).toBe(true);

    await page.goto('/people');
    await page.locator('#debts-link').click();
    await expect(page.locator('#debt-rank li')).toHaveCount(2);
    await expect(page.locator('#debt-rank li').first()).toHaveAttribute('data-debt', 'E2E CARD');
    await expect(page.locator('#debt-rank li').first()).toContainText('Card balance carried over · 51.11% a year');
    await expect(page.locator('#debts-total .amount')).toHaveText('₹1,10,000.00');
    await expect(page.locator('[data-warning="minimum_only"]')).toContainText('E2E CARD: paying only the minimum (₹3,000.00 now)');

    await expect(page.locator('#plan-highest')).toContainText('Debt-free');
    await page.locator('#debt-extra').fill('5000');
    await expect(page.locator('#debt-saved')).toContainText(/Highest rate first saves ₹[\d,]+\.\d\d in interest/);
    await expect(page.locator('#plan-highest')).toContainText('Order: E2E CARD, Bike loan');
    await expect(page.locator('#plan-smallest')).toContainText('Order: Bike loan, E2E CARD');
});

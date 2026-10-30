// @ts-check
/**
 * What's due (/calendar, v2 Phase 4): reached from Accounts; a card bill and a monthly rent in one
 * list, with what is to pay this month and next and from which account.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const india = new Date(Date.now() + 330 * 60_000);
const daysFrom = n => new Date(india.getTime() + n * 86_400_000).toISOString().slice(0, 10);

test('a card bill and the rent in one list, with the totals and the account they come from', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Due Bank', 100000);
    expect((await page.request.post('/api/credit-cards', { data: { name: 'E2E Due Card', creditLimit: 50000 } })).ok()).toBe(true);
    const accounts = await (await page.request.get('/api/accounts')).json();
    const bank = accounts.find(account => account.type === 'bank');
    const card = accounts.find(account => account.type === 'credit_card');
    expect((await page.request.post('/api/entries', { data: { type: 'expense', description: 'Shoes', amount: 4000, accountId: card.id, date: daysFrom(-12) } })).ok()).toBe(true);
    expect((await page.request.post(`/api/cards/${card.id}/statements`, { data: { statementDate: daysFrom(-10), dueOn: daysFrom(4), amountDue: '4000' } })).ok()).toBe(true);
    expect((await page.request.post('/api/recurring', { data: {
        type: 'expense', description: 'Flat rent', amount: 15000, accountId: bank.id, frequency: 'monthly', dayOfMonth: Math.min(Number(daysFrom(2).slice(8)), 28), startsOn: daysFrom(1), mode: 'confirm',
    } })).ok()).toBe(true);

    await page.goto('/setup');
    await page.locator('#calendar-link').click();
    await expect(page.locator('[data-due="E2E DUE CARD bill"]')).toContainText('₹4,000.00');
    await expect(page.locator('[data-due="Flat rent"]').first()).toContainText('₹15,000.00');
    await expect(page.locator('[data-due="Flat rent"]').first()).toContainText('E2E DUE BANK');
    // One or two rent dates fall in the two months
    await expect(page.locator('#due-accounts [data-account="E2E DUE BANK"]')).toContainText(/₹(15,000|30,000)\.00/);
});

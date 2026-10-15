// @ts-check
/**
 * Money with people (/people, v2 Phase 3): shown in the sidebar once "Debts and people" is on;
 * lend with interest as ₹ per ₹100 a month, get some back, and settle what is left as a gift.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('lend to a person, get part back, settle the rest as a gift', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E People Bank', 50000);
    await expect(page.locator('#nav-bar [data-section="people"]')).toHaveCount(0);

    // "Debts and people" on: People appears in the sidebar
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    await page.reload();
    await page.locator('#nav-bar [data-section="people"]').click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.locator('#people-empty')).toBeVisible();

    await page.locator('#person-name').fill('Rahul');
    await page.locator('[data-action="addPerson"]').click();
    await expect(toast(page, 'Rahul added')).toBeVisible();
    const rahul = page.locator('[data-person="Rahul"]');
    await expect(rahul.locator('.person-balance')).toHaveText('All square');

    await rahul.locator('[data-action="lend"]').click();
    await page.locator('#loan-amount').fill('10000');
    await page.locator('#loan-rate').fill('2');
    await page.locator('#loan-unit').selectOption('per100month');
    await page.locator('[data-action="savePersonLoan"]').click();
    await expect(toast(page, 'Lent ₹10,000.00 to Rahul')).toBeVisible();
    await expect(rahul.locator('.person-balance')).toHaveText('Owes you ₹10,000.00');
    await expect(rahul.locator('.person-loan')).toContainText('24% a year (₹2 per ₹100 a month)');
    await expect(page.locator('#people-owed-to-you')).toContainText('₹10,000.00');

    await rahul.locator('[data-action="repay"]').click();
    await page.locator('#repay-amount').fill('4000');
    await expect(page.locator('#repayment-split')).toHaveText('₹4,000.00 towards what is owed, ₹0.00 interest');
    await page.locator('[data-action="saveRepayment"]').click();
    await expect(toast(page, '₹4,000.00 recorded')).toBeVisible();
    await expect(rahul.locator('.person-balance')).toHaveText('Owes you ₹6,000.00');
    await expect(rahul.locator('.budget-figures')).toHaveText('₹6,000.00 left');

    await rahul.locator('[data-action="settleGift"]').click();
    await expect(page.locator('#settle-text')).toContainText('Rahul keeps the ₹6,000.00 still owed');
    await page.locator('[data-action="confirmSettle"]').click();
    await expect(rahul.locator('.person-balance')).toHaveText('All square');
    await expect(rahul.locator('.tag.status-settled')).toHaveText('Settled');

    // The bank: 50,000 - 10,000 + 4,000
    await page.goto('/setup');
    await expect(page.locator('#banks-list li', { hasText: 'E2E PEOPLE BANK' })).toContainText('44,000.00');
});

// @ts-check
/**
 * Loans (/loans, v2 Phase 3): add a home loan already running, pay an EMI (split into interest and
 * principal), make a part payment, and see the year's figures and the schedule.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('a running home loan: EMI, part payment, and the year\'s figures', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Loan Bank', 300000);
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    await page.goto('/setup');
    await page.locator('#nav-bar [data-section="loans"]').click();
    await expect(page.locator('#loans-empty')).toBeVisible();

    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
    await page.locator('#loan-name').fill('Home loan');
    await page.locator('#loan-lender').fill('SBI');
    await page.locator('#loan-principal').fill('1000000');
    await page.locator('#loan-rate').fill('9');
    await page.locator('#loan-months').fill('240');
    await page.locator('#loan-disbursed').fill(twoYearsAgo);
    await page.locator('#loan-outstanding').fill('940000');
    await page.locator('[data-action="addLoan"]').click();
    await expect(toast(page, 'Home loan added')).toBeVisible();

    const loan = page.locator('[data-loan="Home loan"]');
    await expect(loan.locator('.loan-owed')).toHaveText('₹9,40,000.00 owed');
    await expect(loan.locator('.loan-facts')).toContainText('9% a year (₹0.75 per ₹100 a month)');
    await expect(page.locator('#loans-monthly')).toContainText('₹8,998.00');

    await loan.locator('[data-action="payEmi"]').click();
    await expect(page.locator('#act-amount')).toHaveValue('8998.00');
    await page.locator('[data-action="saveLoanAction"]').click();
    await expect(toast(page, 'EMI of ₹8,998.00 recorded')).toBeVisible();
    await expect(loan.locator('.loan-owed')).toHaveText('₹9,38,052.00 owed');
    await expect(loan.locator('.loan-years')).toContainText('Principal ₹1,948.00, interest ₹7,050.00, fees ₹0.00');

    await loan.locator('[data-action="prepay"]').click();
    await expect(page.locator('#act-keep')).toHaveValue('emi');
    await page.locator('#act-amount').fill('100000');
    await page.locator('[data-action="saveLoanAction"]').click();
    await expect(toast(page, 'Part payment of ₹1,00,000.00 recorded')).toBeVisible();
    await expect(toast(page, 'This saves about')).toBeVisible();
    await expect(loan.locator('.loan-owed')).toHaveText('₹8,38,052.00 owed');

    await loan.locator('details.loan-more summary', { hasText: 'Repayment schedule' }).click();
    await expect(loan.locator('.loan-schedule tbody tr').first()).toBeVisible();
});

test('a gold loan: the gold valued, then a lower gold rate brings a margin warning', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Gold Bank', 50000);
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    await page.goto('/loans');
    await page.locator('[data-status="new"]').click();
    await page.locator('#loan-name').fill('Gold loan');
    await page.locator('#loan-kind').selectOption('gold');
    await page.locator('#loan-principal').fill('180000');
    await page.locator('#loan-rate').fill('1');
    await page.locator('#loan-unit').selectOption('per100month');
    await page.locator('#loan-rate-type').selectOption('interest_only');
    await page.locator('#loan-months').fill('12');
    await page.locator('#loan-disbursed').fill(new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10));
    await page.locator('#pledge-weight').fill('50');
    await page.locator('#pledge-purity').selectOption('22');
    await page.locator('#pledge-rate').fill('7200');
    await page.locator('#pledge-description').fill('Two bangles');
    await page.locator('[data-action="addLoan"]').click();
    await expect(toast(page, 'Gold loan added')).toBeVisible();

    const loan = page.locator('[data-loan="Gold loan"]');
    await expect(loan.locator('.pledge-line')).toContainText('Two bangles: worth ₹3,30,000.00');
    await expect(loan.locator('.pledge-ltv')).toHaveText('The loan is 54.55% of its value; the lender\'s limit is 75%');
    await expect(loan.locator('[data-risk="ok"]')).toBeVisible();

    await loan.locator('[data-action="revalue"]').click();
    await page.locator('#act-revalue').fill('5400');
    await page.locator('[data-action="saveLoanAction"]').click();
    await expect(toast(page, 'Valued again: ₹2,47,500.00')).toBeVisible();
    await expect(loan.locator('[data-risk="near"]')).toBeVisible();
});

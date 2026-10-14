// @ts-check
/**
 * Insights (/insights, v2 Phase 2): opened from Summary; unusual spend, category averages over 3
 * or 6 months, and a subscription with a price rise.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const pad = n => String(n).padStart(2, '0');
const india = new Date(Date.now() + 330 * 60_000);
const monthDay = (back, day) => {
    const date = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth() - back, day));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

test('insights: unusual spend, averages and subscriptions', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Insights Bank', 500000);
    const bank = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'bank');
    const categories = await (await page.request.get('/api/categories')).json();
    const id = name => categories.find(category => category.name === name).id;
    const expense = (date, description, amount, category) => ({ type: 'expense', date, description, amount, accountId: bank.id, categoryId: id(category) });
    const saved = await page.request.post('/api/entries/bulk', { data: { entries: [
        expense(monthDay(3, 1), 'Petrol', '2000', 'Fuel'), expense(monthDay(2, 1), 'Petrol', '2000', 'Fuel'),
        expense(monthDay(1, 1), 'Petrol', '2000', 'Fuel'), expense(monthDay(0, 1), 'Petrol', '5000', 'Fuel'),
        expense(monthDay(4, 5), 'Netflix', '499', 'Subscriptions'), expense(monthDay(3, 5), 'Netflix', '499', 'Subscriptions'),
        expense(monthDay(2, 5), 'Netflix', '499', 'Subscriptions'), expense(monthDay(1, 5), 'Netflix', '649', 'Subscriptions'),
    ] } });
    expect(saved.ok()).toBe(true);

    await page.goto('/summary');
    await page.locator('#insights-link').click();
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.locator('#insights-thresholds')).toContainText('Information, not advice');
    await expect(page.locator('#insights-regular')).toHaveText('Regular spending ₹5,000.00');
    await expect(page.locator('#insights-unusual [data-unusual="Fuel"]')).toHaveText('Fuel: ₹5,000.00 this month, 2.5 times its 3-month average of ₹2,000.00.');
    await expect(page.locator('#insights-averages [data-category="Fuel"] .amount')).toHaveText('₹2,000.00 a month');
    await page.locator('#insights-averages [data-span="6"]').click();
    // Fewer than six months of entries: no 6-month average yet
    await expect(page.locator('#insights-averages [data-category="Fuel"]')).toHaveCount(0);
    await expect(page.locator('#insights-subscriptions [data-subscription="Netflix"]')).toContainText('Price up from ₹499.00');
    await expect(page.locator('#insights-subscriptions-total')).toHaveText('₹649.00 a month, ₹7,788.00 a year');
});

test('budgets: set on Insights, warned at 80% after a quick add, changed and removed', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Budget Bank', 50000);
    await page.goto('/insights');
    await expect(page.locator('#budget-list')).toContainText('No budgets yet');
    await page.locator('#budget-category').selectOption({ label: 'Groceries' });
    await page.locator('#budget-amount').fill('1000');
    await page.locator('[data-action="addBudget"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Groceries: ₹1,000.00 a month' })).toBeVisible();
    const budget = page.locator('#budget-list [data-budget="Groceries"]');
    await expect(budget).toContainText('₹0.00 of ₹1,000.00, ₹1,000.00 left');

    await page.locator('#nav-bar [data-action="quickAdd"]').click();
    await page.locator('#quick-amount').fill('850');
    await page.locator('#quick-add-modal .chip[data-category="Groceries"]').click();
    await page.locator('[data-action="saveQuickAdd"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Groceries has used 85% of its budget: ₹850.00 of ₹1,000.00 this month.' })).toBeVisible();

    await page.reload();
    await expect(budget).toHaveClass(/budget-near/);
    await expect(budget.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '85');
    await budget.locator('[data-action="editBudget"]').click();
    await budget.locator('input').fill('2000');
    await budget.locator('[data-action="saveBudget"]').click();
    await expect(budget).toContainText('₹850.00 of ₹2,000.00, ₹1,150.00 left');
    await budget.locator('[data-action="removeBudget"]').click();
    await expect(page.locator('#budget-list')).toContainText('No budgets yet');
});

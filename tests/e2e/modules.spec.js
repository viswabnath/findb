// @ts-check
/**
 * Module switches: a preset at the welcome step, switching in Settings, and the one-time
 * suggestion after an entry whose title points to a switched-off module.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, showSection, addBank, selectAccount, today } = require('./helpers');

test('a preset at sign-up, a switch in Settings, and a suggestion offered once', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await page.locator('[data-action="choosePreset"][data-preset="spending"]').click();
    await expect(page.locator('#setup-section')).toBeVisible();

    await showSection(page, 'settings');
    const box = name => page.locator(`#modules-section input[data-module="${name}"]`);
    await expect(box('spending')).toBeChecked();
    await expect(box('income')).not.toBeChecked();
    await box('income').click();
    await expect(box('income')).toBeChecked();

    await showSection(page, 'setup');
    await addBank(page, 'Module Bank', 50000);
    await showSection(page, 'transactions');
    await page.locator('#expense-title').fill('Bike loan EMI');
    await page.locator('#expense-amount').fill('2000');
    await page.locator('#expense-date').fill(today());
    await selectAccount(page, 'expense-payment-method', 'MODULE BANK');
    await page.locator('[data-action="addExpense"]').click();
    await expect(page.locator('#module-suggestion')).toContainText('Debts and people');
    await page.locator('[data-action="declineModule"]').click();
    await expect(page.locator('#module-suggestion')).toHaveCount(0);

    await page.locator('#expense-title').fill('Another loan EMI');
    await page.locator('#expense-amount').fill('100');
    await selectAccount(page, 'expense-payment-method', 'MODULE BANK');
    await page.locator('[data-action="addExpense"]').click();
    await expect(page.locator('#transactions-section')).toContainText('Another loan EMI');
    await expect(page.locator('#module-suggestion')).toHaveCount(0);
});

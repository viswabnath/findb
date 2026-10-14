// @ts-check
/**
 * Faster entry (v2 Phase 2): quick add from any screen (one-tap categories, the account remembered,
 * the list updated without a reload) and the "Add many" grid, with rows pasted from a spreadsheet
 * and a refused row named by its number.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

async function newUser(page) {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await expect(page.locator('#setup-section')).toBeVisible();
    await addBank(page, 'E2E Quick Bank', 10000);
    return user;
}

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('quick add from Accounts and from Transactions', async ({ page }) => {
    await newUser(page);
    await page.reload();

    await page.locator('#nav-bar [data-action="quickAdd"]').click();
    await expect(page.locator('#quick-add-modal')).toBeVisible();
    await expect(page.locator('#quick-amount')).toBeFocused();
    await expect(page.locator('#quick-account option:checked')).toHaveText('E2E QUICK BANK');
    await page.locator('#quick-amount').fill('250');
    await page.locator('[data-action="saveQuickAdd"]').click();
    await expect(toast(page, 'Choose a category')).toBeVisible();
    await page.locator('#quick-add-modal .chip[data-category="Groceries"]').click();
    await page.locator('[data-action="saveQuickAdd"]').click();
    await expect(toast(page, '₹250.00 spent on Groceries')).toBeVisible();
    await expect(page.locator('#quick-add-modal')).toBeHidden();
    // Accounts start again with the new balance
    await expect(page.locator('#banks-list li', { hasText: 'E2E QUICK BANK' })).toContainText('9,750.00');

    await page.goto('/transactions');
    await expect(page.locator('#transactions-section')).toContainText('Groceries');
    await page.locator('#nav-bar [data-action="quickAdd"]').click();
    await page.locator('[data-kind="income"]').click();
    await page.locator('#quick-amount').fill('500');
    await page.locator('#quick-category').selectOption({ label: 'Freelance' });
    await page.locator('#quick-note').fill('Logo design');
    await page.locator('#quick-add-form').press('Enter');
    await expect(toast(page, '₹500.00 received as Freelance')).toBeVisible();
    // The list shows it without a reload
    await expect(page.locator('#transactions-section')).toContainText('Logo design');
});

test('quick add sits in the top bar on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await newUser(page);
    await page.locator('[data-action="quickAddPhone"]').click();
    await expect(page.locator('#quick-add-modal')).toBeVisible();
    await expect(page.locator('#quick-add-modal .chip')).toHaveCount(6);
});

test('add many: rows pasted from a spreadsheet, a refused row named, then all saved', async ({ page }) => {
    await newUser(page);
    await page.goto('/transactions');
    await page.locator('#add-many-link').click();
    await expect(page).toHaveURL(/\/add-many$/);
    await expect(page.locator('#add-many-rows li')).toHaveCount(5);

    const year = new Date().getFullYear() - 1;
    const text = `01/10/${year}\tMilk\t60\tGroceries\n02/10/${year}\tBonus\t"5,000.00"\tSalary\n`;
    await page.locator('#add-many-rows li[data-row="1"] [data-field="description"]').evaluate((input, pasted) => {
        const data = new DataTransfer();
        data.setData('text/plain', pasted);
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
    await expect(toast(page, '2 rows pasted')).toBeVisible();

    const row = n => page.locator(`#add-many-rows li[data-row="${n}"]`);
    await expect(row(1).locator('[data-field="description"]')).toHaveValue('Milk');
    await expect(row(1).locator('input[type="date"]')).toHaveValue(`${year}-10-01`);
    await expect(row(1).locator('[data-field="other"] option:checked')).toHaveText('Groceries');
    await expect(row(2).locator('[data-field="type"]')).toHaveValue('income');
    await expect(row(2).locator('[data-field="amount"]')).toHaveValue('5000.00');
    await expect(row(2).locator('[data-field="other"] option:checked')).toHaveText('Salary');

    // Row 4 has a description but no amount: nothing is saved, and the row is named
    await row(4).locator('[data-field="description"]').fill('Forgot the amount');
    await expect(page.locator('#add-many-count')).toHaveText('3 filled in');
    await page.locator('[data-action="saveMany"]').click();
    await expect(page.locator('#add-many-problem')).toHaveText('Row 4: Enter a valid amount');

    await row(4).locator('[data-field="amount"]').fill('99');
    await row(4).locator('[data-field="type"]').selectOption('transfer');
    await expect(row(4).locator('[data-field="other"] option:checked')).toHaveText('To Cash');
    await page.locator('[data-action="saveMany"]').click();
    await expect(toast(page, '3 entries saved')).toBeVisible();
    await expect(page.locator('#add-many-count')).toHaveText('0 filled in');

    await page.goto('/setup');
    // 10,000 - 60 + 5,000 - 99
    await expect(page.locator('#banks-list li', { hasText: 'E2E QUICK BANK' })).toContainText('14,841.00');
});

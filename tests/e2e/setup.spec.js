// @ts-check
/**
 * Account Setup moved to Next.js (/setup) in N2. The add flows are covered by flows.spec.js;
 * this covers the rest of the screen: validation, edit and delete dialogs, tracking-option
 * visibility, escaping, navigation, and the CSP.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, rupees, today, addBank, bankRow, cardRow, showSection } = require('./helpers');

async function newUser(page, tracking = 'both') {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, tracking);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.locator('#setup-section')).toBeVisible();
    return user;
}

test('/setup without a session goes to /login', async ({ page }) => {
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
});

test('setup renders under the nonce CSP without console errors, and the nav links to and from Activity work', async ({ page }) => {
    // Watch from Setup on: registration's own pages are covered by auth-pages.spec.js
    await newUser(page);
    const problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI || 'inline'}`)));

    const response = await page.reload();
    expect(response?.headers()['content-security-policy'] || '').toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);

    await showSection(page, 'activity');
    await expect(page).toHaveURL(/\/activity$/);
    await showSection(page, 'setup');
    await expect(page).toHaveURL(/\/setup$/);

    expect(problems).toEqual([]);
});

test('inline validation messages', async ({ page }) => {
    await newUser(page);

    await page.locator('[data-action="addBank"]').click();
    await expect(page.locator('#bank-message')).toHaveText('Please enter bank name');
    await page.locator('#bank-name').fill('x');
    await expect(page.locator('#bank-message')).toBeHidden();

    await page.locator('#cc-name').fill('Card');
    await page.locator('[data-action="addCreditCard"]').click();
    await expect(page.locator('#credit-card-message')).toHaveText('Please enter a valid credit limit greater than 0');

    await page.locator('#cash-balance').fill('-5');
    await page.locator('[data-action="setCashBalance"]').click();
    await expect(page.locator('#cash-message')).toHaveText('Please enter a valid cash balance (0 or greater)');
});

test('edit a bank: changing the initial balance moves the current balance by the difference', async ({ page }) => {
    await newUser(page);
    await addBank(page, 'Kotak Main', 1000);

    await bankRow(page, 'Kotak Main').locator('[data-action="edit-bank"]').click();
    await expect(page.locator('#edit-bank-modal')).toBeVisible();
    await expect(page.locator('#edit-bank-balance')).toHaveValue('1000');
    await page.locator('#edit-bank-name').fill('Kotak Salary');
    await page.locator('#edit-bank-balance').fill('1500');
    await page.locator('[data-action="save-bank"]').click();

    await expect(page.locator('.toast-message', { hasText: 'Bank updated successfully' })).toBeVisible();
    await expect(page.locator('#edit-bank-modal')).toBeHidden();
    await expect(bankRow(page, 'Kotak Salary')).toContainText(rupees(1500));
});

test('delete a bank; a bank with transactions is refused', async ({ page }) => {
    await newUser(page);
    await addBank(page, 'Spare Bank', 100);
    await addBank(page, 'Busy Bank', 1000);

    // Give "Busy Bank" a transaction through the API (same session as the page)
    const banks = await (await page.request.get('/api/banks')).json();
    const busy = banks.find(bank => bank.name === 'BUSY BANK');
    const income = await page.request.post('/api/income', {
        data: { source: 'Salary', amount: 50, creditedToType: 'bank', creditedToId: busy.id, date: today() },
    });
    expect(income.ok()).toBe(true);

    await bankRow(page, 'Spare Bank').locator('[data-action="delete-bank"]').click();
    await expect(page.locator('#delete-setup-message')).toHaveText('Are you sure you want to delete this bank?');
    await page.locator('[data-action="confirm-delete-setup"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Bank deleted successfully' })).toBeVisible();
    await expect(bankRow(page, 'Spare Bank')).toHaveCount(0);

    await bankRow(page, 'Busy Bank').locator('[data-action="delete-bank"]').click();
    await page.locator('[data-action="confirm-delete-setup"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Cannot delete bank with existing transactions' })).toBeVisible();
    await expect(bankRow(page, 'Busy Bank')).toHaveCount(1);
});

test('edit and delete a credit card', async ({ page }) => {
    await newUser(page);
    await page.locator('#cc-name').fill('Travel Card');
    await page.locator('#cc-limit').fill('20000');
    await page.locator('[data-action="addCreditCard"]').click();
    await expect(cardRow(page, 'Travel Card')).toContainText(rupees(20000));

    await cardRow(page, 'Travel Card').locator('[data-action="edit-credit-card"]').click();
    await expect(page.locator('#credit-card-used-info')).toContainText(`Used now: ${rupees(0)}`);
    await page.locator('#edit-credit-card-limit').fill('25000');
    await page.locator('[data-action="save-credit-card"]').click();
    await expect(cardRow(page, 'Travel Card')).toContainText(rupees(25000));

    await cardRow(page, 'Travel Card').locator('[data-action="delete-credit-card"]').click();
    await expect(page.locator('#delete-setup-message')).toHaveText('Are you sure you want to delete this credit card?');
    await page.locator('[data-action="confirm-delete-setup"]').click();
    await expect(page.locator('#credit-cards-list')).toContainText('No credit cards added yet.');
});

test('edit the cash balance (edit is disabled until cash is set)', async ({ page }) => {
    await newUser(page);
    await expect(page.locator('[data-action="edit-cash-balance"]')).toBeDisabled();

    await page.locator('#cash-balance').fill('300');
    await page.locator('[data-action="setCashBalance"]').click();
    await expect(page.locator('#cash-display')).toContainText(rupees(300));

    await page.locator('[data-action="edit-cash-balance"]').click();
    await expect(page.locator('#edit-cash-balance')).toHaveValue('300');
    await page.locator('#edit-cash-balance').fill('450');
    await page.locator('[data-action="save-cash-balance"]').click();
    await expect(page.locator('#cash-display')).toContainText(rupees(450));
});

test('income-only users do not see the credit card section', async ({ page }) => {
    await newUser(page, 'income');
    await expect(page.locator('#bank-setup')).toBeVisible();
    await expect(page.locator('#credit-card-setup')).toBeHidden();
});

test('bank names are shown as text, never as HTML', async ({ page }) => {
    await newUser(page);
    await page.locator('#bank-name').fill('<b>bold</b>');
    await page.locator('[data-action="addBank"]').click();

    const row = bankRow(page, '<B>BOLD</B>');
    await expect(row).toHaveCount(1);
    await expect(row.locator('b')).toHaveCount(0);
});

// @ts-check
/**
 * Transactions moved to Next.js (/transactions) in N2. Add, edit and delete with balance
 * checks are covered by flows.spec.js; this covers the rest of the screen: messages, the
 * month filter, the "moved to another month" notice, the delete dialog, tracking-option
 * visibility, escaping, navigation, and the CSP.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, rupees, today, addBank, showSection, selectAccount } = require('./helpers');

/** A date in January of last year: never in the month the screen opens on */
const OLD_DATE = `${new Date().getFullYear() - 1}-01-15`;

async function newUser(page, tracking = 'both') {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, tracking);
    await expect(page.locator('#setup-section')).toBeVisible();
    return user;
}

async function addIncome(page, source, amount, date = today()) {
    await page.locator('#income-source').fill(source);
    await page.locator('#income-amount').fill(String(amount));
    await page.locator('#income-date').fill(date);
    await page.locator('[data-action="addIncome"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Income added successfully!');
}

const incomeRow = (page, source) => page.locator('#income-table-body tr', { hasText: source });
const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('/transactions without a session goes to /login', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login$/);
});

test('transactions renders under the nonce CSP without console errors, and the nav links to and from Activity work', async ({ page }) => {
    await newUser(page);
    const problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI || 'inline'}`)));

    await showSection(page, 'transactions');
    await expect(page).toHaveURL(/\/transactions$/);
    const response = await page.reload();
    expect(response?.headers()['content-security-policy'] || '').toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    await expect(page.locator('#transactions-section')).toBeVisible();

    await showSection(page, 'activity');
    await expect(page).toHaveURL(/\/activity$/);
    await showSection(page, 'transactions');
    await expect(page).toHaveURL(/\/transactions$/);

    expect(problems).toEqual([]);
});

test('form messages: missing fields, success, and an API refusal', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'transactions');

    await page.locator('[data-action="addIncome"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Please fill all fields');
    await expect(page.locator('#transactions-message')).toHaveClass('error');

    await addIncome(page, 'Bonus', 700);
    await expect(page.locator('#transactions-message')).toHaveClass('success');
    await expect(page.locator('#income-source')).toHaveValue('');
    await expect(incomeRow(page, 'Bonus')).toContainText(rupees(700));

    // Users who track income too cannot spend cash they do not have (the 700 went into cash)
    await page.locator('#expense-title').fill('Taxi');
    await page.locator('#expense-amount').fill('700.01');
    await page.locator('[data-action="addExpense"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Insufficient cash balance');
    await expect(page.locator('#expense-table-body')).toContainText('No expense transactions found for this period');
});

test('the month filter shows other months', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'transactions');

    await addIncome(page, 'Old Invoice', 900, OLD_DATE);
    await expect(incomeRow(page, 'Old Invoice')).toHaveCount(0);
    await expect(page.locator('#income-table-body')).toContainText('No income transactions found for this period');

    const year = String(new Date().getFullYear() - 1);
    await page.locator('#transaction-month').selectOption('1');
    await page.locator('#transaction-year').selectOption(year);
    await page.locator('[data-action="filterTransactions"]').click();
    await expect(toast(page, `Loading transactions for January ${year}...`)).toBeVisible();
    await expect(incomeRow(page, 'Old Invoice')).toContainText(rupees(900));
});

test('editing an entry into another month says where it went', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'transactions');
    await addIncome(page, 'Consulting', 1500);

    await incomeRow(page, 'Consulting').locator('[data-action="edit-income"]').click();
    await expect(page.locator('#edit-income-modal')).toBeVisible();
    await expect(page.locator('#edit-income-source')).toHaveValue('Consulting');
    await expect(page.locator('#edit-income-date')).toHaveValue(today());
    await page.locator('#edit-income-date').fill(OLD_DATE);
    await page.locator('[data-action="save-income-edit"]').click();

    await expect(toast(page, 'Income transaction updated successfully!')).toBeVisible();
    await expect(toast(page, `Transaction moved to January ${new Date().getFullYear() - 1}. Change filter to view it.`)).toBeVisible();
    await expect(page.locator('#edit-income-modal')).toBeHidden();
    await expect(incomeRow(page, 'Consulting')).toHaveCount(0);
});

test('the delete dialog names the entry, and cancel keeps it', async ({ page }) => {
    await newUser(page);
    await addBank(page, 'Yes Bank', 5000);
    await showSection(page, 'transactions');

    await page.locator('#expense-title').fill('Groceries');
    await page.locator('#expense-amount').fill('1234.5');
    await selectAccount(page, 'expense-payment-method', 'YES BANK');
    await page.locator('[data-action="addExpense"]').click();
    const row = page.locator('#expense-table-body tr', { hasText: 'Groceries' });
    await expect(row).toContainText('YES BANK');

    await row.locator('[data-action="delete-expense"]').click();
    const message = page.locator('#delete-confirmation-message');
    await expect(message).toContainText('Are you sure you want to delete this expense transaction?');
    await expect(message).toContainText('Title: Groceries');
    await expect(message).toContainText(`Amount: ${rupees(1234.5)}`);
    await page.locator('#delete-confirmation-modal [data-action="close-delete"]').last().click();
    await expect(page.locator('#delete-confirmation-modal')).toBeHidden();
    await expect(row).toHaveCount(1);
});

test('tracking option decides which forms and lists are shown', async ({ page }) => {
    await newUser(page, 'income');
    await showSection(page, 'transactions');
    await expect(page.locator('#income-form')).toBeVisible();
    await expect(page.locator('#expense-form')).toBeHidden();
    await expect(page.locator('#expense-history')).toBeHidden();
});

test('expenses-only users do not see income', async ({ page }) => {
    await newUser(page, 'expenses');
    await showSection(page, 'transactions');
    await expect(page.locator('#expense-form')).toBeVisible();
    await expect(page.locator('#income-form')).toBeHidden();
    await expect(page.locator('#income-history')).toBeHidden();
});

test('sources are shown as text, never as HTML', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'transactions');
    await addIncome(page, '<b>bold</b>', 10);

    const row = incomeRow(page, '<b>bold</b>');
    await expect(row).toHaveCount(1);
    await expect(row.locator('b')).toHaveCount(0);
});

test('a wallet is added on Accounts, money moves into it, and the move is neither income nor spending', async ({ page }) => {
    await newUser(page);
    await addBank(page, 'Canara Main', 5000);
    await page.locator('#other-type').selectOption('wallet');
    await page.locator('#other-name').fill('Paytm Wallet');
    await page.locator('#other-balance').fill('0');
    await page.locator('[data-action="addOtherAccount"]').click();
    await expect(page.locator('#other-account-message')).toHaveText('Wallet added successfully!');
    await expect(page.locator('#other-accounts-list tr', { hasText: 'Paytm Wallet' })).toContainText(rupees(0));

    await showSection(page, 'transactions');
    await selectAccount(page, 'transfer-from', 'CANARA MAIN');
    await page.locator('#transfer-to').selectOption({ label: 'Paytm Wallet' });
    await page.locator('#transfer-amount').fill('750');
    await page.locator('#transfer-note').fill('Wallet top-up');
    await page.locator('[data-action="addTransfer"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Transfer added successfully!');
    const row = page.locator('#transfer-table-body tr', { hasText: 'Wallet top-up' });
    await expect(row).toContainText(rupees(750));
    await expect(row).toContainText('CANARA MAIN');
    await expect(row).toContainText('Paytm Wallet');
    // Money in and out are unchanged by a transfer
    await expect(page.locator('.stat', { hasText: 'Money in' }).locator('.stat-value')).toHaveText(rupees(0));
    await expect(page.locator('.stat', { hasText: 'Money out' }).locator('.stat-value')).toHaveText(rupees(0));

    await showSection(page, 'setup');
    await expect(page.locator('#other-accounts-list tr', { hasText: 'Paytm Wallet' })).toContainText(rupees(750));
    await expect(page.locator('#banks-list tr', { hasText: 'CANARA MAIN' })).toContainText(rupees(4250));
});

// @ts-check
/**
 * Monthly Summary moved to Next.js (/summary) in N2. flows.spec.js checks that income shows
 * up in the summary; this covers the rest of the screen: the cards and breakdown, account
 * balances, the "no data" messages and their buttons, escaping, navigation and the CSP.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, rupees, today, addBank, showSection, selectAccount } = require('./helpers');

async function newUser(page, tracking = 'both') {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, tracking);
    await expect(page.locator('#setup-section')).toBeVisible();
    return user;
}

async function loadSummary(page, month, year) {
    await page.locator('#summary-month').selectOption(String(month));
    await page.locator('#summary-year').selectOption(String(year));
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/monthly-summary');
    await page.locator('[data-action="loadMonthlySummary"]').click();
    await loaded;
}

const display = page => page.locator('#summary-display');

test('/summary without a session goes to /login', async ({ page }) => {
    await page.goto('/summary');
    await expect(page).toHaveURL(/\/login$/);
});

test('summary renders under the nonce CSP without console errors, and the nav links to and from Activity work', async ({ page }) => {
    await newUser(page);
    const problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI || 'inline'}`)));

    await showSection(page, 'summary');
    await expect(page).toHaveURL(/\/summary$/);
    const response = await page.reload();
    expect(response?.headers()['content-security-policy'] || '').toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    await expect(page.locator('#summary-section')).toBeVisible();

    await showSection(page, 'activity');
    await expect(page).toHaveURL(/\/activity$/);
    await showSection(page, 'summary');
    await expect(page).toHaveURL(/\/summary$/);

    expect(problems).toEqual([]);
});

test('a month with entries shows the cards, account balances and the breakdown', async ({ page }) => {
    await newUser(page);
    await addBank(page, 'Kotak <b>Main</b>', 10000);
    await page.locator('#cc-name').fill('Fuel Card');
    await page.locator('#cc-limit').fill('20000');
    await page.locator('[data-action="addCreditCard"]').click();
    await expect(page.locator('#credit-cards-list')).toContainText('FUEL CARD');

    await showSection(page, 'transactions');
    await page.locator('#income-source').fill('Salary');
    await page.locator('#income-amount').fill('3000');
    await selectAccount(page, 'income-credited-to', 'KOTAK <B>MAIN</B>');
    await page.locator('#income-date').fill(today());
    await page.locator('[data-action="addIncome"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Income added successfully!');
    await page.locator('#expense-title').fill('Fuel');
    await page.locator('#expense-amount').fill('500');
    await selectAccount(page, 'expense-payment-method', 'FUEL CARD');
    await page.locator('[data-action="addExpense"]').click();
    await expect(page.locator('#transactions-message')).toHaveText('Expense added successfully!');

    await showSection(page, 'summary');
    const month = new Date().toLocaleString('en-US', { month: 'long' });
    await expect(display(page)).toContainText(`${month} ${new Date().getFullYear()} Financial Summary`);
    await expect(page.locator('.summary-card.income .summary-amount')).toHaveText(rupees(3000));
    await expect(page.locator('.summary-card.expense .summary-amount')).toHaveText(rupees(500));
    await expect(page.locator('.summary-card.wealth .summary-subtitle')).toHaveText('Banks, cash and wallets as of now');

    const bank = page.locator('.account-card.bank');
    await expect(bank).toContainText('KOTAK <B>MAIN</B>');
    await expect(bank.locator('b')).toHaveCount(0);
    await expect(bank).toContainText(rupees(13000));
    await expect(page.locator('.account-card.credit')).toContainText(`${rupees(500)} used`);
    await expect(page.locator('.account-card.credit')).toContainText(`${rupees(19500)} available of ${rupees(20000)}`);
    await expect(display(page)).toContainText('Calculation Breakdown');
});

test('future months and months before registration say there is no data', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'summary');
    const year = new Date().getFullYear();

    await loadSummary(page, 1, year + 1);
    await expect(display(page)).toContainText('Future date selected - no data available');
    await expect(display(page)).toContainText('Cannot show data for future dates.');

    await loadSummary(page, 1, year - 1);
    await expect(display(page)).toContainText('Date before registration - no data available');
    await expect(display(page)).toContainText('You were not registered during this period.');
});

test('a new user with nothing set up is pointed to Setup and Transactions', async ({ page }) => {
    await newUser(page);
    await showSection(page, 'summary');
    await expect(display(page)).toContainText('No transactions found for this month');

    await page.locator('.add-transactions-btn').click();
    await expect(page).toHaveURL(/\/transactions$/);
    await page.goBack();
    await page.locator('.setup-accounts-btn').click();
    await expect(page).toHaveURL(/\/setup$/);
});

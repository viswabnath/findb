// @ts-check
/**
 * Core user flows, written against the current app before the Next.js migration.
 * Every migration step must keep these passing.
 */
const { test, expect } = require('@playwright/test');
const {
    uniqueUser, rupees, today, register, chooseTracking, login, logout,
    showSection, addBank, selectAccount, bankRow, cardRow,
} = require('./helpers');

test('register, choose tracking and set up accounts', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await expect(page.locator('#setup-section')).toBeVisible();

    await addBank(page, 'Hdfc Savings', 100000);
    await expect(bankRow(page, 'Hdfc Savings')).toContainText(rupees(100000));

    await page.locator('#cc-name').fill('Travel Card');
    await page.locator('#cc-limit').fill('50000');
    await page.locator('[data-action="addCreditCard"]').click();
    await expect(cardRow(page, 'Travel Card')).toContainText(rupees(50000));

    await page.locator('#cash-balance').fill('2500');
    await page.locator('[data-action="setCashBalance"]').click();
    await expect(page.locator('#cash-display')).toContainText(rupees(2500));
});

test('income and expenses update balances on add, edit and delete', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await addBank(page, 'Axis Salary', 10000);
    await page.locator('#cc-name').fill('Shopping Card');
    await page.locator('#cc-limit').fill('5000');
    await page.locator('[data-action="addCreditCard"]').click();
    await expect(cardRow(page, 'Shopping Card')).toBeVisible();

    // Income into the bank
    await showSection(page, 'transactions');
    await page.locator('#income-source').fill('Salary');
    await page.locator('#income-amount').fill('2500');
    await selectAccount(page, 'income-credited-to', 'AXIS SALARY');
    await page.locator('#income-date').fill(today());
    await page.locator('[data-action="addIncome"]').click();
    const incomeRow = page.locator('#income-table-body li', { hasText: 'Salary' });
    await expect(incomeRow).toContainText(rupees(2500));

    await showSection(page, 'setup');
    await expect(bankRow(page, 'Axis Salary')).toContainText(rupees(12500));

    // Edit the income amount
    await showSection(page, 'transactions');
    await incomeRow.locator('[data-action="edit-income"]').click();
    await page.locator('#edit-income-amount').fill('3000');
    await page.locator('[data-action="save-income-edit"]').click();
    await expect(incomeRow).toContainText(rupees(3000));

    await showSection(page, 'setup');
    await expect(bankRow(page, 'Axis Salary')).toContainText(rupees(13000));

    // Expense on the card, then delete both entries
    await showSection(page, 'transactions');
    await page.locator('#expense-title').fill('Headphones');
    await page.locator('#expense-amount').fill('1200');
    await selectAccount(page, 'expense-payment-method', 'SHOPPING CARD');
    await page.locator('#expense-date').fill(today());
    await page.locator('[data-action="addExpense"]').click();
    const expenseRow = page.locator('#expense-table-body li', { hasText: 'Headphones' });
    await expect(expenseRow).toContainText(rupees(1200));

    await showSection(page, 'setup');
    await expect(cardRow(page, 'Shopping Card')).toContainText(rupees(1200));

    await showSection(page, 'transactions');
    await expenseRow.locator('[data-action="delete-expense"]').click();
    await page.locator('[data-action="confirm-delete"]').click();
    await expect(expenseRow).toHaveCount(0);
    await incomeRow.locator('[data-action="delete-income"]').click();
    await page.locator('[data-action="confirm-delete"]').click();
    await expect(incomeRow).toHaveCount(0);

    await showSection(page, 'setup');
    await expect(bankRow(page, 'Axis Salary')).toContainText(rupees(10000));
    await expect(cardRow(page, 'Shopping Card')).toContainText(rupees(0));
});

test('monthly summary, activity feed and CSV export reflect entries', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await addBank(page, 'Icici Main', 5000);

    await showSection(page, 'transactions');
    await page.locator('#income-source').fill('Freelance');
    await page.locator('#income-amount').fill('4000');
    await selectAccount(page, 'income-credited-to', 'ICICI MAIN');
    await page.locator('#income-date').fill(today());
    await page.locator('[data-action="addIncome"]').click();
    await expect(page.locator('#income-table-body li', { hasText: 'Freelance' })).toBeVisible();

    await showSection(page, 'summary');
    await page.locator('[data-action="loadMonthlySummary"]').click();
    await expect(page.locator('#summary-display')).toContainText(rupees(4000));

    await showSection(page, 'activity');
    await expect(page.locator('#activity-list')).toContainText('Added income: Freelance');
    await expect(page.locator('#activity-list')).toContainText('Added bank account: ICICI MAIN');

    // The export is API-only; use the page's logged-in session
    const csv = await page.request.get('/api/activity?export=true');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('Added income: Freelance');
});

test('logout ends the session and login restores it', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');

    await logout(page);
    const afterLogout = await page.request.get('/api/banks');
    expect(afterLogout.status()).toBe(401);

    await login(page, user);
    const afterLogin = await page.request.get('/api/banks');
    expect(afterLogin.status()).toBe(200);
});

test('forgot username shows the username after the security answer', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await logout(page);

    await page.locator('[data-action="showForgotUsername"]').click();
    await page.locator('#forgot-username-email-input').fill(user.email);
    await page.locator('[data-action="forgotUsername"]').click();
    await expect(page.locator('#forgot-username-question')).toHaveText('What was the name of your first pet?');

    await page.locator('#forgot-username-answer').fill('wrong answer');
    await page.locator('[data-action="verifyUsernameRecovery"]').click();
    await expect(page.locator('#auth-message')).toContainText('Security answer could not be verified');

    await page.locator('#forgot-username-answer').fill(user.securityAnswer);
    await page.locator('[data-action="verifyUsernameRecovery"]').click();
    await expect(page.locator('#auth-message')).toContainText(`Username found: ${user.username}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('#login-username')).toHaveValue(user.username);
});

test('recovery looks the same for an email with no account', async ({ page }) => {
    await page.goto('/forgot-username');
    await page.locator('#forgot-username-email-input').fill(`${uniqueUser().username}@example.test`);
    await page.locator('[data-action="forgotUsername"]').click();
    await expect(page.locator('#forgot-username-question')).not.toBeEmpty();
    await page.locator('#forgot-username-answer').fill('anything');
    await page.locator('[data-action="verifyUsernameRecovery"]').click();
    await expect(page.locator('#auth-message')).toContainText('Security answer could not be verified');

    await page.goto('/forgot-password');
    await page.locator('#forgot-username-email').fill('nobody_e2e_unknown');
    await page.locator('[data-action="requestPasswordReset"]').click();
    await expect(page.locator('#reset-security-question')).not.toBeEmpty();
});

test('forgot password resets it through the security question', async ({ page }) => {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await logout(page);

    await page.locator('[data-action="showForgotPassword"]').click();
    await page.locator('#forgot-username-email').fill(user.email);
    await page.locator('[data-action="requestPasswordReset"]').click();
    await expect(page.locator('#reset-password-form')).toBeVisible();
    await expect(page.locator('#reset-security-question')).not.toBeEmpty();

    const newPassword = 'New_pass2';
    await page.locator('#reset-security-answer').fill(user.securityAnswer);
    await page.locator('#reset-new-password').fill(newPassword);
    await page.locator('#reset-confirm-password').fill(newPassword);
    await page.locator('[data-action="resetPassword"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Password reset successfully' })).toBeVisible();

    await login(page, user, newPassword);
});

// @ts-check
/**
 * Statement import (/import, v2 Phase 2): a known bank layout from a CSV, reviewed and imported
 * with its transfer and categories, then undone; an unknown layout from an Excel file, with the
 * columns chosen once and remembered, and the same statement again flagged as duplicates.
 */
const { test, expect } = require('@playwright/test');
const XLSX = require('xlsx');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const pad = n => String(n).padStart(2, '0');
/** A date some days ago, as a statement writes it: day first, two-digit year */
function statementDate(daysAgo) {
    const date = new Date(Date.now() - daysAgo * 86_400_000);
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(2)}`;
}

async function newUser(page) {
    const user = uniqueUser();
    await register(page, user);
    await chooseTracking(page, 'both');
    await expect(page.locator('#setup-section')).toBeVisible();
    await addBank(page, 'E2E Import Bank', 10000);
    return user;
}

async function openImport(page) {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/imports');
    await page.goto('/transactions');
    await page.locator('#import-statement-link').click();
    await expect(page).toHaveURL(/\/import$/);
    await loaded;
    await expect(page.locator('#import-account')).toBeVisible();
}

const row = (page, line) => page.locator(`#import-rows li[data-line="${line}"]`);
const chosen = (page, line) => row(page, line).locator('select.import-action option:checked');

test('a known bank layout: reviewed, imported with a transfer and categories, then undone', async ({ page }) => {
    await newUser(page);
    await openImport(page);

    const csv = [
        'HDFC BANK Ltd.,,,,,,',
        'Statement of account,,,,,,',
        'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
        `${statementDate(6)},UPI-SWIGGY LIMITED-swiggy@hdfcbank-HDFC0MERUPI-412345678901-Payment,0000412345678901,${statementDate(6)},450.00,,"9,550.00"`,
        `${statementDate(5)},NEFT CR-ICIC0000001-ACME PVT LTD-SALARY-N123,N123,${statementDate(5)},,"5,000.00","14,550.00"`,
        `${statementDate(4)},ATW-512345XXXXXX1234-S1ANMU01-MUMBAI,0000123,${statementDate(4)},"2,000.00",,"12,550.00"`,
        `${statementDate(3)},INTEREST PAID TILL 30-SEP,,${statementDate(3)},,12.00,"12,562.00"`,
        ',,,,,,',
        'STATEMENT SUMMARY :-,,,,,,',
    ].join('\n');
    await page.locator('#import-file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    await expect(page.locator('#import-layout')).toHaveText('HDFC Bank account layout');
    await expect(page.locator('#import-read-count')).toContainText('4 transactions');
    await expect(page.locator('#import-rows li')).toHaveCount(4);
    await expect(row(page, 4).locator('.import-description')).toHaveValue('Swiggy Limited');
    await expect(chosen(page, 4)).toHaveText('Restaurants and food delivery');
    await expect(chosen(page, 5)).toHaveText('Salary');
    await expect(chosen(page, 6)).toHaveText('Transfer to Cash');
    await expect(row(page, 6).locator('[data-note="atm"]')).toBeVisible();
    await expect(chosen(page, 7)).toHaveText('Interest');
    await expect(page.locator('#import-selected')).toHaveText('4 of 4 to import');
    await expect(page.locator('#import-balances')).toContainText('The statement ends at ₹12,562.00');

    // Leave one out and rename another
    await row(page, 7).locator('[data-action="includeRow"]').uncheck();
    await row(page, 4).locator('.import-description').fill('Swiggy dinner');
    await expect(page.locator('#import-selected')).toHaveText('3 of 4 to import');
    await page.locator('[data-action="importRows"]').click();

    await expect(page.locator('#import-done-text')).toHaveText('3 entries are now in E2E IMPORT BANK, 1 of them a transfer.');
    await expect(page.locator('#import-closing')).toBeVisible();
    await expect(page.locator('#import-history-list li')).toHaveCount(1);

    await page.goto('/transactions');
    await expect(page.locator('#transactions-section')).toContainText('Swiggy dinner');

    await page.goto('/import');
    await page.locator('#import-history-list [data-action="undoImport"]').click();
    await expect(page.locator('#undo-import-text')).toContainText('Its 3 entries leave your accounts');
    await page.locator('[data-action="confirm-undo-import"]').click();
    await expect(page.locator('.toast-message', { hasText: 'Import undone: 3 entries removed' })).toBeVisible();
    await expect(page.locator('#import-history-list li .tag')).toHaveText('Undone');
});

test('an unknown layout from Excel: columns chosen once and remembered, and a second import finds the duplicates', async ({ page }) => {
    await newUser(page);
    await openImport(page);

    const sheet = XLSX.utils.aoa_to_sheet([
        ['My bank export'],
        ['When', 'What', 'Paid', 'Got'],
        [statementDate(4), 'Corner shop', 120.5, ''],
        [statementDate(3), 'Refund from Ravi', '', 300],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Statement');
    const file = { name: 'export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
    await page.locator('#import-file').setInputFiles(file);

    await expect(page.locator('#import-columns-editor')).toBeVisible();
    await expect(page.locator('#import-layout')).toHaveText('Choose which column holds what');
    await expect(page.locator('#import-header-line')).toHaveValue('2');
    await page.locator('#import-column-date').selectOption({ label: 'When' });
    await page.locator('#import-column-description').selectOption({ label: 'What' });
    await expect(page.locator('#import-columns-problem')).toHaveText('Choose an amount column (money out and in, or one amount)');
    await page.locator('#import-column-debit').selectOption({ label: 'Paid' });
    await page.locator('#import-column-credit').selectOption({ label: 'Got' });
    await expect(page.locator('.import-sample li')).toHaveCount(2);
    await page.locator('[data-action="useColumns"]').click();

    await expect(page.locator('#import-rows li')).toHaveCount(2);
    await expect(row(page, 3).locator('.amount')).toHaveText('-₹120.50');
    await page.locator('[data-action="importRows"]').click();
    await expect(page.locator('#import-done-text')).toHaveText('2 entries are now in E2E IMPORT BANK.');

    // The same file again: the columns are remembered, and both rows are already in FinDB
    await page.locator('#import-file').setInputFiles(file);
    await expect(page.locator('#import-layout')).toHaveText('The columns you chose last time for this layout');
    await expect(page.locator('#import-duplicates')).toHaveText('2 rows are already in FinDB and are left out; tick one to import it anyway.');
    await expect(page.locator('#import-selected')).toHaveText('0 of 2 to import');
    await expect(page.locator('[data-action="importRows"]')).toBeDisabled();
    await expect(row(page, 3).locator('[data-note="duplicate"]')).toContainText('Already in FinDB: Corner shop');
});

test('a file that is not a statement says so', async ({ page }) => {
    await newUser(page);
    await openImport(page);
    await page.locator('#import-file').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('1,2,3\n4,5,6\n') });
    await expect(page.locator('#import-problem')).toHaveText('No statement table was found in this file. Is it the account statement as CSV or Excel?');
});

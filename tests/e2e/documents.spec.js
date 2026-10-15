// @ts-check
/**
 * The document vault (/documents, v2 Phase 2): upload a PDF with its details, open it, find it by
 * financial year, delete it; attach a receipt to an entry from Transactions; a large photo is made
 * smaller on the device before it is uploaded.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');
const { statementPdf } = require('./pdf-fixture');

async function newUser(page) {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Docs Bank', 50000);
}

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('upload, open, filter by year and delete a document', async ({ page }) => {
    await newUser(page);
    await page.goto('/transactions');
    await page.locator('#documents-link').click();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.locator('#documents-list')).toContainText('No documents yet');

    const pdf = statementPdf([[[40, 700, 'Policy schedule']]]);
    await page.locator('#document-file').setInputFiles({ name: 'policy.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#document-kind').selectOption('policy');
    await page.locator('#document-title').fill('Car insurance');
    await page.locator('#document-date').fill('2026-04-02');
    await page.locator('#document-account').selectOption({ label: 'E2E DOCS BANK' });
    await page.locator('[data-action="uploadDocument"]').click();
    await expect(toast(page, 'Car insurance is in your documents')).toBeVisible();

    const row = page.locator('#documents-list [data-document="Car insurance"]');
    await expect(row).toContainText('Insurance policy · 2 Apr 2026 · FY 2026-27');
    await expect(row.locator('.tag')).toHaveText('E2E DOCS BANK');
    const href = await row.locator('[data-action="openDocument"]').getAttribute('href');
    const file = await page.request.get(href ?? '');
    expect(file.headers()['content-type']).toBe('application/pdf');
    expect(Buffer.compare(await file.body(), pdf)).toBe(0);

    // Only years that have documents are offered
    await expect(page.locator('#documents-filter-year option')).toHaveText(['All', 'FY 2026-27']);
    await page.locator('#documents-filter-kind').selectOption('receipt');
    await expect(page.locator('#documents-list')).toContainText('No documents of this type or year.');
    await page.locator('#documents-filter-kind').selectOption('');
    await page.locator('#documents-filter-year').selectOption('2026-27');
    await expect(row).toBeVisible();

    await row.locator('[data-action="deleteDocument"]').click();
    await page.locator('[data-action="confirmDeleteDocument"]').click();
    await expect(toast(page, 'Car insurance deleted')).toBeVisible();
    await expect(page.locator('#documents-list')).toContainText('No documents yet');
});

test('attach a receipt to an entry; a large photo is made smaller first', async ({ page }) => {
    await newUser(page);
    const bank = (await (await page.request.get('/api/accounts')).json()).find(account => account.type === 'bank');
    const saved = await page.request.post('/api/entries', { data: { type: 'expense', date: new Date().toISOString().slice(0, 10), description: 'Dinner at Toit', amount: '2400', accountId: bank.id } });
    expect(saved.ok()).toBe(true);
    await page.goto('/transactions');
    await page.locator('#transactions-section [data-action="entryDocuments"]').first().click();
    await expect(page.locator('#attach-documents-modal')).toBeVisible();
    await expect(page.locator('#attached-documents')).toContainText('Nothing attached yet.');

    // A 3000 x 3000 photo drawn on this page: far over 2 MB as PNG noise, shrunk before upload
    const original = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 3000;
        canvas.height = 3000;
        const context = canvas.getContext('2d');
        const pixels = context.createImageData(3000, 3000);
        for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
        context.putImageData(pixels, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], 'bill.png', { type: 'image/png' });
        const data = new DataTransfer();
        data.items.add(file);
        const input = document.querySelector('#attach-file');
        input.files = data.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return file.size;
    });
    expect(original).toBeGreaterThan(2 * 1024 * 1024);
    await expect(toast(page, 'Dinner at Toit is in your documents')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#attached-documents li')).toHaveCount(1);

    const vault = await (await page.request.get('/api/documents')).json();
    expect(vault.documents[0]).toMatchObject({ title: 'Dinner at Toit', kind: 'receipt', mimeType: 'image/jpeg', fileName: 'bill.jpg' });
    expect(vault.documents[0].size).toBeLessThan(1024 * 1024);
});

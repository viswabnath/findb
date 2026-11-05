// @ts-check
/**
 * Share to FinDB (v2 Phase 5). A phone's share sheet cannot be driven from a test, so each test
 * puts the shared item where the service worker keeps it (the "findb-share" cache) and opens
 * /share: a bank SMS fills quick add in, and a statement goes to Import. Without the worker, a
 * share posted to the server is sent to /share to try again.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

/** What public/sw.js keeps for a share */
async function keepShared(page, { text = '', file = null }) {
    await page.evaluate(async ({ text, file }) => {
        const cache = await caches.open('findb-share');
        await cache.put('/shared/meta', new Response(JSON.stringify({ title: '', text, url: '', file: file ? { name: file.name, type: file.type } : null }), { headers: { 'Content-Type': 'application/json' } }));
        if (file) await cache.put('/shared/file', new Response(file.content, { headers: { 'Content-Type': file.type } }));
    }, { text, file });
}

test('a bank SMS shared to FinDB opens quick add filled in', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Share Bank', 10000);
    await keepShared(page, { text: 'Rs.450.00 debited from A/c XX1234 on 05-11-26 to VPA swiggy@icici (UPI Ref No 412345678901). -HDFC Bank' });

    await page.goto('/share');
    await expect(page.locator('#quick-add-modal')).toBeVisible();
    await expect(page.locator('#quick-amount')).toHaveValue('450.00');
    await expect(page.locator('#share-status')).toContainText('Check what was read in Quick add');
    // Taken once: opening /share again finds nothing
    await page.goto('/share');
    await expect(page.locator('#share-status')).toContainText('Nothing is waiting here');
});

test('a statement shared to FinDB opens in Import', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Share Import Bank', 10000);
    const day = new Date(Date.now() - 2 * 86_400_000);
    const date = `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}/${String(day.getFullYear()).slice(2)}`;
    const csv = [
        'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
        `${date},UPI-SWIGGY LIMITED-swiggy@hdfcbank-HDFC0MERUPI-412345678901-Payment,0000412345678901,${date},450.00,,"9,550.00"`,
    ].join('\n');
    await keepShared(page, { file: { name: 'statement.csv', type: 'text/csv', content: csv } });

    await page.goto('/share');
    await expect(page).toHaveURL(/\/import\?shared=1$/);
    await expect(page.locator('#import-layout')).toHaveText('HDFC Bank account layout');
    await expect(page.locator('#import-rows li')).toHaveCount(1);
});

test('without the service worker, a share posted to the server is sent to try again', async ({ request }) => {
    const response = await request.post('/share-target', { multipart: { text: 'Rs 10 debited' }, maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe('/share?again=1');
});

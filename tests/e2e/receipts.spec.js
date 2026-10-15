// @ts-check
/**
 * Reading receipts (v2 Phase 2): a receipt and a UPI screenshot, drawn as pictures, are read in the
 * browser by quick add (tesseract.js from FinDB's own files, under the app's CSP), fill in the
 * amount, date and name, and the picture is kept in Documents with the entry.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const pad = n => String(n).padStart(2, '0');
const india = new Date(Date.now() + 330 * 60_000);
const DAY = `${pad(india.getUTCDate())}/${pad(india.getUTCMonth() + 1)}/${india.getUTCFullYear()}`;
const ISO = `${india.getUTCFullYear()}-${pad(india.getUTCMonth() + 1)}-${pad(india.getUTCDate())}`;
const MONTH = india.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const SHORT = `${india.getUTCDate()} ${MONTH} ${india.getUTCFullYear()}`;

/** A picture of some lines of text, as a phone camera or screenshot would give it */
async function picture(browser, html) {
    const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2 });
    await page.setContent(`<body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#111">${html}</body>`);
    const image = await page.locator('body > div').screenshot();
    await page.close();
    return image;
}

async function readInQuickAdd(page, image, name) {
    await page.locator('#nav-bar [data-action="quickAdd"]').click();
    await expect(page.locator('#quick-add-modal')).toBeVisible();
    await page.locator('#quick-receipt').setInputFiles({ name, mimeType: 'image/png', buffer: image });
    await expect(page.locator('#quick-receipt-note')).toBeVisible({ timeout: 60_000 });
}

test('a receipt and a UPI screenshot are read on the device, and the receipt is kept', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        event => console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI || 'inline'}`)));

    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Receipt Bank', 50000);

    const receipt = await picture(browser, `<div style="padding:28px;width:340px;font-size:22px;line-height:1.5">
        <div style="font-size:28px;font-weight:bold">THE BIRYANI HOUSE</div><div>12 MG Road Bengaluru</div><div>TAX INVOICE</div>
        <div>Date: ${DAY}</div><div>Chicken Biryani 560.00</div><div>Sub Total 620.00</div><div>CGST 15.50</div><div>SGST 15.50</div>
        <div style="font-weight:bold">Grand Total 651.00</div><div>Thank you</div></div>`);
    await readInQuickAdd(page, receipt, 'bill.png');
    await expect(page.locator('#quick-receipt-note')).toHaveText('Filled in from the picture: the amount, the date, the name. Check them before saving.');
    await expect(page.locator('#quick-amount')).toHaveValue('651.00');
    await expect(page.locator('#quick-date')).toHaveValue(ISO);
    await expect(page.locator('#quick-note')).toHaveValue('The Biryani House');
    await expect(page.locator('#quick-receipt-keep')).toBeChecked();
    await page.locator('#quick-add-modal .chip[data-category="Restaurants and food delivery"]').click();
    await page.locator('[data-action="saveQuickAdd"]').click();
    await expect(page.locator('.toast-message', { hasText: '₹651.00 spent on Restaurants and food delivery' })).toBeVisible();

    const vault = await (await page.request.get('/api/documents')).json();
    expect(vault.documents).toHaveLength(1);
    expect(vault.documents[0]).toMatchObject({ kind: 'receipt', title: 'The Biryani House', date: ISO, links: [{ type: 'entry', name: 'The Biryani House' }] });

    const screenshot = await picture(browser, `<div style="padding:32px;width:340px;text-align:center;font-size:22px;line-height:1.6">
        <div>To Swiggy</div><div style="color:#555">swiggy.payu@hdfcbank</div><div style="font-size:48px;font-weight:bold">₹450</div>
        <div>Completed</div><div>${SHORT}, 10:31 pm</div><div>UPI transaction ID</div><div>428712345678</div><div>Google Pay</div></div>`);
    await page.reload();
    await readInQuickAdd(page, screenshot, 'gpay.png');
    await expect(page.locator('#quick-amount')).toHaveValue('450.00');
    await expect(page.locator('#quick-note')).toHaveValue('Swiggy');
    await expect(page.locator('#quick-date')).toHaveValue(ISO);

    expect(problems).toEqual([]);
});

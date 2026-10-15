// @ts-check
/**
 * Chit funds (/chits, v2 Phase 3): add a chit, record an auction, and pay the month less its
 * dividend; the return is shown against an RD and a personal loan.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('a chit: auction, payment less the dividend, and its true return', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Chit Bank', 100000);
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    await page.goto('/setup');
    await page.locator('#nav-bar [data-section="chits"]').click();
    await expect(page.locator('#chits-empty')).toBeVisible();

    await page.locator('#chit-name').fill('Office chit');
    await page.locator('#chit-value').fill('100000');
    await page.locator('#chit-members').fill('10');
    await page.locator('#chit-start').fill(new Date().toISOString().slice(0, 10));
    await page.locator('[data-action="addChit"]').click();
    await expect(toast(page, 'Office chit added')).toBeVisible();

    const chit = page.locator('[data-chit="Office chit"]');
    await expect(chit.locator('.loan-facts')).toContainText('₹1,00,000.00 chit · 10 members · 10 months · ₹10,000.00 a month');
    await chit.locator('[data-action="recordAuction"]').click();
    await page.locator('#record-discount').fill('20000');
    await page.locator('[data-action="saveChitRecord"]').click();
    await expect(toast(page, 'Month 1\'s auction recorded')).toBeVisible();
    await expect(chit.locator('.chit-next')).toContainText('Next: month 1, ₹8,500.00');

    await chit.locator('[data-action="payChit"]').click();
    await page.locator('[data-action="saveChitRecord"]').click();
    await expect(toast(page, 'Month 1 paid: ₹8,500.00')).toBeVisible();
    await expect(chit.locator('.chit-balance')).toHaveText('₹10,000.00 saved in the chit');
    await expect(chit.locator('.chit-outcome')).toContainText('As a saver');
    await expect(chit.locator('.form-note')).toContainText('an RD earns about');
});

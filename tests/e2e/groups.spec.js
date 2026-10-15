// @ts-check
/**
 * Shared expenses and groups (/groups, v2 Phase 3): a trip with two friends; you pay the train,
 * a friend pays the hotel; balances, the settle-up plan, and a payment marked as made.
 */
const { test, expect } = require('@playwright/test');
const { uniqueUser, register, chooseTracking, addBank } = require('./helpers');

const toast = (page, text) => page.locator('.toast-message', { hasText: text });

test('a trip: costs paid by you and by a friend, balances, and settling up', async ({ page }) => {
    await register(page, uniqueUser());
    await chooseTracking(page, 'both');
    await addBank(page, 'E2E Group Bank', 50000);
    expect((await page.request.put('/api/modules', { data: { modules: ['income', 'spending', 'credit_cards', 'debts'] } })).ok()).toBe(true);
    for (const name of ['Rahul', 'Sneha']) expect((await page.request.post('/api/people', { data: { name } })).ok()).toBe(true);

    await page.goto('/setup');
    await page.locator('#nav-bar [data-section="groups"]').click();
    await expect(page).toHaveURL(/\/groups$/);
    await page.locator('#group-name').fill('Ooty trip');
    await page.locator('.group-new .chip[data-person="Rahul"]').click();
    await page.locator('.group-new .chip[data-person="Sneha"]').click();
    await page.locator('[data-action="createGroup"]').click();
    await expect(page.locator('#group-detail')).toHaveAttribute('data-group', 'Ooty trip');

    await page.locator('#cost-description').fill('Train');
    await page.locator('#cost-amount').fill('3000');
    await page.locator('[data-action="addCost"]').click();
    await expect(toast(page, 'Train added')).toBeVisible();
    await expect(page.locator('#group-your-balance')).toHaveText('is owed ₹2,000.00');

    await page.locator('#cost-description').fill('Hotel');
    await page.locator('#cost-amount').fill('6000');
    await page.locator('#cost-paid-by').selectOption({ label: 'Rahul' });
    await expect(page.locator('#cost-account')).toHaveCount(0);
    await page.locator('[data-action="addCost"]').click();
    await expect(toast(page, 'Hotel added')).toBeVisible();
    await expect(page.locator('#group-cost')).toHaveText('your share ₹3,000.00 of ₹9,000.00');
    await expect(page.locator('#group-members [data-member="Sneha"]')).toContainText('owes ₹3,000.00');
    await expect(page.locator('#group-plan li')).toHaveCount(1);
    await expect(page.locator('#group-plan li')).toContainText('Sneha pays Rahul ₹3,000.00');

    await page.locator('[data-action="recordPlan"]').click();
    await expect(page.locator('#group-plan')).toHaveCount(0);
    await expect(page.locator('#group-your-balance')).toHaveText('settled up');

    // Your two shares are your spending; changed only from the group
    await page.goto('/transactions');
    await expect(page.locator('#transactions-section')).toContainText('Hotel');
    await expect(page.locator('#transactions-section .row-actions a', { hasText: 'From a group' }).first()).toBeVisible();
});

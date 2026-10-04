/**
 * Cash Balance Activity Test
 * Tests that cash balance entries appear in activity feed
 */

const request = require('supertest');
const { target } = require('./api-target');
const { deleteTestUser, enableTestTwoFactor, logIn } = require('../test-helpers');

describe('Cash Balance Activity', () => {
    let agent;

    beforeAll(async () => {
        await deleteTestUser('testuser_cash');
        agent = request.agent(target());

        // Register and login a test user
        const registerResponse = await agent
            .post('/api/register')
            .send({
                username: 'testuser_cash',
                password: 'Cashflow_Pass9',
                name: 'Test User',
                email: 'testcash@example.com',
                securityQuestion: 'What is your pet name?',
                securityAnswer: 'fluffy'
            });

        expect(registerResponse.status).toBe(200);
        // Registration leaves two-factor setup to do; the test user gets the known test secret
        await enableTestTwoFactor(registerResponse.body.userId);

        const loginResponse = await logIn(agent, 'testuser_cash', 'Cashflow_Pass9');

        expect(loginResponse.status).toBe(200);
    });

    afterAll(async () => {
        await deleteTestUser('testuser_cash');
    });

    test('should include cash balance in activity feed after setting cash balance', async () => {
        // Set cash balance
        const cashResponse = await agent
            .post('/api/cash-balance')
            .send({
                balance: 5000.00
            });

        expect(cashResponse.status).toBe(200);

        // Get activity feed
        const activityResponse = await agent
            .get('/api/activity');

        expect(activityResponse.status).toBe(200);

        // Check if cash balance activity is included
        const { activities } = activityResponse.body;
        const cashActivity = activities.find(activity =>
            activity.activity_type === 'cash_balance' &&
            activity.description === 'Set initial cash balance: ₹5000.00'
        );

        expect(cashActivity).toBeDefined();
        expect(cashActivity.amount).toBe('5000.00');
        expect(cashActivity.account_info).toBe('Cash');
        expect(cashActivity.action_type).toBe('created');
    });

    test('should show cash balance activity alongside bank activities', async () => {
        // Add a bank
        const bankResponse = await agent
            .post('/api/banks')
            .send({
                name: 'Test Bank',
                initialBalance: 10000.00
            });

        expect(bankResponse.status).toBe(200);

        // Get activity feed
        const activityResponse = await agent
            .get('/api/activity');

        expect(activityResponse.status).toBe(200);

        const { activities } = activityResponse.body;

        // Check both cash and bank activities exist
        const cashActivity = activities.find(activity =>
            activity.activity_type === 'cash_balance' &&
            activity.description === 'Set initial cash balance: ₹5000.00'
        );

        const bankActivity = activities.find(activity =>
            activity.activity_type === 'bank' &&
            activity.description.includes('Added bank account: TEST BANK')
        );

        expect(cashActivity).toBeDefined();
        expect(bankActivity).toBeDefined();

        expect(cashActivity.activity_type).toBe('cash_balance');
        expect(bankActivity.activity_type).toBe('bank');
    });
});

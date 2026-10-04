/**
 * Bank Deletion Fix Test
 * Tests that bank deletion works correctly with proper table names
 */

const request = require('supertest');
const { target } = require('./api-target');
const { deleteTestUser, enableTestTwoFactor, logIn } = require('../test-helpers');

describe('Bank Deletion Fix', () => {
    let agent;
    let bankId;

    beforeAll(async () => {
        await deleteTestUser('testuser_bankdel');
        agent = request.agent(target());

        // Register and login a test user
        const registerResponse = await agent
            .post('/api/register')
            .send({
                username: 'testuser_bankdel',
                password: 'Bankdel_Pass9',
                name: 'Test User',
                email: 'bankdel@example.com',
                securityQuestion: 'What is your pet name?',
                securityAnswer: 'fluffy'
            });

        expect(registerResponse.status).toBe(200);
        // Registration leaves two-factor setup to do; the test user gets the known test secret
        await enableTestTwoFactor(registerResponse.body.userId);

        const loginResponse = await logIn(agent, 'testuser_bankdel', 'Bankdel_Pass9');

        expect(loginResponse.status).toBe(200);
    });

    afterAll(async () => {
        await deleteTestUser('testuser_bankdel');
    });

    test('should be able to delete a bank without transactions', async () => {
        // Create a bank
        const bankResponse = await agent
            .post('/api/banks')
            .send({
                name: 'Test Bank to Delete',
                initialBalance: 1000.00
            });

        expect(bankResponse.status).toBe(200);
        bankId = bankResponse.body.id;

        // Delete the bank
        const deleteResponse = await agent
            .delete(`/api/banks/${bankId}`);

        expect(deleteResponse.status).toBe(200);
        expect(deleteResponse.body.success).toBe(true);
        expect(deleteResponse.body.message).toBe('Bank deleted successfully');
    });

    test('should prevent deletion of bank with transactions', async () => {
        // Create a bank
        const bankResponse = await agent
            .post('/api/banks')
            .send({
                name: 'Test Bank with Transactions',
                initialBalance: 2000.00
            });

        expect(bankResponse.status).toBe(200);
        const bankWithTransactionsId = bankResponse.body.id;

        // Add an expense transaction using this bank
        const expenseResponse = await agent
            .post('/api/expenses')
            .send({
                title: 'Test Expense',
                amount: 100.00,
                paymentMethod: 'bank',
                paymentSourceId: bankWithTransactionsId,
                date: '2025-08-02'
            });

        expect(expenseResponse.status).toBe(200);

        // Try to delete the bank - should fail
        const deleteResponse = await agent
            .delete(`/api/banks/${bankWithTransactionsId}`);

        expect(deleteResponse.status).toBe(400);
        expect(deleteResponse.body.error).toContain('Cannot delete bank with existing transactions');
    });
});

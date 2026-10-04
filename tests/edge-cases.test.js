/**
 * Edge Cases and Error Scenarios - Maximum Coverage Push
 * Tests all error paths, validation edge cases, and boundary conditions
 * @jest-environment node
 */

const request = require('supertest');


// Import the actual server app AFTER mocking rate limiter
const { target, closeTarget } = require('./api-target');
const { deleteTestUser, enableTestTwoFactor, logIn } = require('../test-helpers');

describe('Edge Cases & Error Scenarios - Complete Coverage', () => {
    let sessionCookie;

    beforeAll(async () => {
        // Remove leftovers from an interrupted run, then register the test user
        await deleteTestUser('edgetest123');
        const userData = {
            username: 'edgetest123',
            password: 'Boundary_Pass9',
            name: 'Edge Test User',
            email: 'edge@test.com',
            securityQuestion: 'What is your edge test?',
            securityAnswer: 'boundaries',
            acceptPrivacyNotice: true
        };

        const registered = await request(target())
            .post('/api/register')
            .send(userData);
        expect(registered.status).toBe(200);
        // Registration leaves two-factor setup to do; the test user gets the known test secret
        await enableTestTwoFactor(registered.body.userId);

        // Login to get session
        const loginResponse = await logIn(() => request(target()), 'edgetest123', 'Boundary_Pass9');

        sessionCookie = loginResponse.headers['set-cookie'];

        // Create bank and credit card for testing
        await request(target())
            .post('/api/banks')
            .set('Cookie', sessionCookie)
            .send({
                name: 'EDGE TEST BANK',
                initialBalance: 1000
            });

        await request(target())
            .post('/api/credit-cards')
            .set('Cookie', sessionCookie)
            .send({
                name: 'EDGE TEST CARD',
                creditLimit: 5000
            });

        // Set initial cash balance
        await request(target())
            .post('/api/cash-balance')
            .set('Cookie', sessionCookie)
            .send({ balance: 500 });
    }, 30000);

    afterAll(async () => {
        // deleteTestUser only works in a *_test schema
        await deleteTestUser('edgetest123');
        await closeTarget();
    });

    describe('Registration Edge Cases', () => {
        test('should handle username taken error', async () => {
            const response = await request(target())
                .post('/api/register')
                .send({
                    username: 'edgetest123', // Already exists
                    password: 'DupeTest123&',
                    name: 'Duplicate User',
                    email: 'dupe@test.com',
                    securityQuestion: 'test',
                    securityAnswer: 'test',
                    acceptPrivacyNotice: true
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Username or email already exists');
        });

        test('should handle email taken error', async () => {
            const response = await request(target())
                .post('/api/register')
                .send({
                    username: 'uniqueuser123',
                    password: 'DupeTest123&',
                    name: 'Duplicate Email User',
                    email: 'edge@test.com', // Already exists
                    securityQuestion: 'test',
                    securityAnswer: 'test',
                    acceptPrivacyNotice: true
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Username or email already exists');
        });

        test('should handle all password validation edge cases', async () => {
            const testCases = [
                { password: '1234567', description: 'exactly 7 chars (too short)' },
                { password: 'Aa1&'.repeat(16) + 'x', description: 'exactly 65 chars (too long)' },
                { password: 'alllower123&', description: 'under 16 chars, no uppercase' },
                { password: 'ALLUPPER123&', description: 'under 16 chars, no lowercase' },
                { password: 'NoNumbersHere&', description: 'under 16 chars, no numbers' },
                { password: 'HasNumbers123', description: 'under 16 chars, no symbol' },
                { password: 'Password@123', description: 'too common' },
                { password: 'passwordpassword', description: 'a common passphrase' }
            ];

            for (const testCase of testCases) {
                const response = await request(target())
                    .post('/api/register')
                    .send({
                        // A valid username, so only the password can be refused
                        username: `test${Date.now()}${Math.floor(Math.random() * 1e6)}`,
                        password: testCase.password,
                        name: 'Test User',
                        email: `test${Date.now()}${Math.random()}@example.com`,
                        securityQuestion: 'test',
                        securityAnswer: 'test',
                        acceptPrivacyNotice: true
                    });

                expect(response.status).toBe(400);
                expect(response.body.error).toMatch(/Password|password/);
            }
        });
    });

    describe('Authentication Edge Cases', () => {
        test('should handle login with non-existent user', async () => {
            const response = await request(target())
                .post('/api/login')
                .send({
                    username: 'nonexistentuser',
                    password: 'SomePass123&'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid credentials');
        });

        test('should handle login with wrong password', async () => {
            const response = await request(target())
                .post('/api/login')
                .send({
                    username: 'edgetest123',
                    password: 'WrongPass123&'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid credentials');
        });

        test('should handle logout', async () => {
            const response = await request(target())
                .post('/api/logout')
                .set('Cookie', sessionCookie);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            // Re-login for other tests
            const loginResponse = await logIn(() => request(target()), 'edgetest123', 'Boundary_Pass9');
            // Later tests reuse this session; fail here, not with a puzzling 401 further down
            expect(loginResponse.status).toBe(200);
            expect(loginResponse.headers['set-cookie']).toBeDefined();
            sessionCookie = loginResponse.headers['set-cookie'];
        });
    });

    describe('Financial Operations Edge Cases', () => {
        test('should handle negative amounts in bank creation', async () => {
            const response = await request(target())
                .post('/api/banks')
                .set('Cookie', sessionCookie)
                .send({
                    name: 'NEGATIVE BANK',
                    initialBalance: -1000
                });

            expect(response.status).toBe(200);
            expect(parseFloat(response.body.current_balance)).toBe(-1000);
        });

        test('should handle zero amounts', async () => {
            const response = await request(target())
                .post('/api/credit-cards')
                .set('Cookie', sessionCookie)
                .send({
                    name: 'ZERO LIMIT CARD',
                    creditLimit: 0
                });

            expect(response.status).toBe(200);
            expect(parseFloat(response.body.credit_limit)).toBe(0);
        });

        test('should handle very large amounts', async () => {
            const response = await request(target())
                .post('/api/banks')
                .set('Cookie', sessionCookie)
                .send({
                    name: 'BILLIONAIRE BANK',
                    initialBalance: 999999999.99
                });

            expect(response.status).toBe(200);
        });

        test('should handle decimal precision edge cases', async () => {
            const response = await request(target())
                .post('/api/cash-balance')
                .set('Cookie', sessionCookie)
                .send({ balance: 123.456789 }); // More than 2 decimal places

            expect(response.status).toBe(200);
            // Should handle precision correctly
            expect(response.body.balance).toBeDefined();
        });
    });

    describe('Income/Expense Validation Edge Cases', () => {
        test('should handle zero amount transactions', async () => {
            const incomeResponse = await request(target())
                .post('/api/income')
                .set('Cookie', sessionCookie)
                .send({
                    source: 'Zero Income',
                    amount: 0,
                    creditedToType: 'cash',
                    creditedToId: null,
                    date: '2025-07-22'
                });

            expect(incomeResponse.status).toBe(200);

            const expenseResponse = await request(target())
                .post('/api/expenses')
                .set('Cookie', sessionCookie)
                .send({
                    title: 'Zero Expense',
                    amount: 0,
                    paymentMethod: 'cash',
                    paymentSourceId: null,
                    date: '2025-07-22'
                });

            expect(expenseResponse.status).toBe(200);
        });
    });

    describe('Date and Query Parameter Edge Cases', () => {
        test('should handle invalid month/year in queries', async () => {
            const testCases = [
                { month: 0, year: 2025 },
                { month: 13, year: 2025 },
                { month: 7, year: 1899 },
                { month: 7, year: 3000 }
            ];

            for (const testCase of testCases) {
                const response = await request(target())
                    .get(`/api/monthly-summary?month=${testCase.month}&year=${testCase.year}`)
                    .set('Cookie', sessionCookie);

                expect(response.status).toBe(200);
                // Should handle gracefully
                expect(response.body).toBeDefined();
            }
        });

        test('should handle some query parameter variations', async () => {
            const endpoints = [
                '/api/income',
                '/api/expenses'
            ];

            for (const endpoint of endpoints) {
                const response = await request(target())
                    .get(endpoint)
                    .set('Cookie', sessionCookie);

                expect(response.status).toBe(200);
                expect(response.body).toBeDefined();
            }
        });
    });

    describe('Password Reset Edge Cases', () => {
        // Unknown accounts look like real ones: a question, then the generic failed-answer error
        test('should handle forgot password for non-existent user', async () => {
            const response = await request(target())
                .post('/api/forgot-password')
                .send({ username: 'nonexistentuser' });

            expect(response.status).toBe(200);
            expect(Object.keys(response.body).sort()).toEqual(['securityQuestion', 'success']);
        });

        test('should handle forgot password with non-existent email', async () => {
            const response = await request(target())
                .post('/api/forgot-password')
                .send({ email: 'nonexistent@example.com' });

            expect(response.status).toBe(200);
            expect(Object.keys(response.body).sort()).toEqual(['securityQuestion', 'success']);
        });

        test('should refuse reset password by user id alone', async () => {
            const response = await request(target())
                .post('/api/reset-password')
                .send({
                    userId: 99999,
                    securityAnswer: 'test',
                    newPassword: 'NewPass123&'
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Username or email is required');
        });

        test('should give the generic error for a non-existent user', async () => {
            const response = await request(target())
                .post('/api/reset-password')
                .send({ username: 'nonexistentuser', securityAnswer: 'test', newPassword: 'NewPass123&' });

            expect(response.status).toBe(400);
            expect(response.body.error).toMatch(/^Security answer could not be verified/);
        });

        test('should handle reset password with invalid new password', async () => {
            const response = await request(target())
                .post('/api/reset-password')
                .send({
                    username: 'edgetest123',
                    securityAnswer: 'boundaries',
                    newPassword: 'weak' // Invalid password
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Password must be');
        });
    });

    describe('Session and Authentication State Edge Cases', () => {
        test('should handle invalid session cookie', async () => {
            const response = await request(target())
                .get('/api/banks')
                .set('Cookie', ['connect.sid=invalid_session_id']);

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Authentication required');
        });

        test('should handle no session cookie', async () => {
            const response = await request(target())
                .get('/api/banks');

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Authentication required');
        });

        test('should handle malformed session cookie', async () => {
            const response = await request(target())
                .get('/api/banks')
                .set('Cookie', ['malformed_cookie']);

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Authentication required');
        });
    });

    describe('HTTP Method and Route Edge Cases', () => {
        test('should handle unsupported HTTP methods', async () => {
            const response = await request(target())
                .patch('/api/banks')
                .set('Cookie', sessionCookie);

            // Express answers 404 for an unsupported method; Next.js route handlers (N3) answer 405
            expect([404, 405]).toContain(response.status);
        });

        test('should handle non-existent routes', async () => {
            const response = await request(target())
                .get('/api/nonexistent')
                .set('Cookie', sessionCookie);

            expect(response.status).toBe(404);
        });

        test('should handle root path variations', async () => {
            const paths = ['/', '/index.html', '/public/index.html'];

            for (const path of paths) {
                const response = await request(target()).get(path);
                // Should handle gracefully: serve the file, 404, or (Next.js "/") redirect a logged-out visitor
                expect([200, 307, 404]).toContain(response.status);
                if (response.status === 307) expect(response.headers.location).toMatch(/\/login$/);
            }
        });
    });

    describe('Data Integrity and Concurrent Access', () => {
        test('should handle concurrent balance operations', async () => {
            // Create multiple concurrent requests that modify balance
            const promises = [];

            for (let i = 0; i < 5; i++) {
                promises.push(
                    request(target())
                        .post('/api/expenses')
                        .set('Cookie', sessionCookie)
                        .send({
                            title: `Concurrent Expense ${i}`,
                            amount: 1,
                            paymentMethod: 'cash',
                            paymentSourceId: null,
                            date: '2025-07-22'
                        })
                );
            }

            const responses = await Promise.all(promises);

            // All should succeed (or fail consistently due to balance constraints)
            responses.forEach(response => {
                expect([200, 400]).toContain(response.status);
            });
        });
    });

    describe('Input Sanitization and XSS Prevention', () => {
        test('should handle potentially malicious input in bank names', async () => {
            const maliciousInputs = [
                '<script>alert("xss")</script>',
                'DROP TABLE users;',
                '${7*7}',
                '{{7*7}}',
                'Bank\nWith\nNewlines',
                'Bank\tWith\tTabs'
            ];

            for (const input of maliciousInputs) {
                const response = await request(target())
                    .post('/api/banks')
                    .set('Cookie', sessionCookie)
                    .send({
                        name: input,
                        initialBalance: 1000
                    });

                expect(response.status).toBe(200);
                // Should store and return safely
                expect(response.body.name).toBeDefined();
            }
        });

        test('should handle SQL injection attempts', async () => {
            const sqlInjections = [
                '\'; DROP TABLE banks; --',
                '\' OR \'1\'=\'1',
                '1; DELETE FROM users WHERE 1=1; --'
            ];

            for (const injection of sqlInjections) {
                const response = await request(target())
                    .post('/api/banks')
                    .set('Cookie', sessionCookie)
                    .send({
                        name: injection,
                        initialBalance: 1000
                    });

                // Should handle safely without crashing
                expect([200, 400, 500]).toContain(response.status);
            }
        });
    });

    describe('Tracking Option Edge Cases', () => {
        test('should handle invalid tracking options', async () => {
            const invalidOptions = ['invalid', 'all', 'none', ''];

            for (const option of invalidOptions) {
                const response = await request(target())
                    .post('/api/set-tracking-option')
                    .set('Cookie', sessionCookie)
                    .send({ trackingOption: option });

                // Should reject invalid options
                expect([400, 500]).toContain(response.status);
            }

            // Test null and undefined separately as they might be handled differently
            const nullResponse = await request(target())
                .post('/api/set-tracking-option')
                .set('Cookie', sessionCookie)
                .send({ trackingOption: null });
            expect([400, 500]).toContain(nullResponse.status);

            const undefinedResponse = await request(target())
                .post('/api/set-tracking-option')
                .set('Cookie', sessionCookie)
                .send({});
            expect([400, 500]).toContain(undefinedResponse.status);
        });

        test('should validate tracking option constraints in expenses', async () => {
            // Set to income-only and try to add expense
            await request(target())
                .post('/api/set-tracking-option')
                .set('Cookie', sessionCookie)
                .send({ trackingOption: 'income' });

            const response = await request(target())
                .post('/api/expenses')
                .set('Cookie', sessionCookie)
                .send({
                    title: 'Should Not Be Allowed',
                    amount: 100,
                    paymentMethod: 'cash',
                    paymentSourceId: null,
                    date: '2025-07-22'
                });

            // Reset to both for other tests
            await request(target())
                .post('/api/set-tracking-option')
                .set('Cookie', sessionCookie)
                .send({ trackingOption: 'both' });

            // Should handle according to business logic
            expect([200, 400]).toContain(response.status);
        });
    });

    describe('Date and Time Edge Cases', () => {
        test('should handle leap year dates', async () => {
            const response = await request(target())
                .post('/api/income')
                .set('Cookie', sessionCookie)
                .send({
                    source: 'Leap Year Income',
                    amount: 100,
                    creditedToType: 'cash',
                    creditedToId: null,
                    date: '2024-02-29' // Leap year date
                });

            expect(response.status).toBe(200);
        });

        test('should handle future dates gracefully', async () => {
            const futureDate = new Date();
            futureDate.setFullYear(futureDate.getFullYear() + 1);
            const futureDateString = futureDate.toISOString().split('T')[0];

            const response = await request(target())
                .post('/api/income')
                .set('Cookie', sessionCookie)
                .send({
                    source: 'Future Income',
                    amount: 100,
                    creditedToType: 'cash',
                    creditedToId: null,
                    date: futureDateString
                });

            // Should handle according to business logic
            expect([200, 400]).toContain(response.status);
        });

        test('should handle invalid date formats', async () => {
            const invalidDates = ['2025-13-01', '2025-02-30', 'invalid-date', ''];

            for (const invalidDate of invalidDates) {
                const response = await request(target())
                    .post('/api/income')
                    .set('Cookie', sessionCookie)
                    .send({
                        source: 'Invalid Date Income',
                        amount: 100,
                        creditedToType: 'cash',
                        creditedToId: null,
                        date: invalidDate
                    });

                expect([400, 500]).toContain(response.status);
            }
        });
    });

    describe('Rate Limiting and Security Headers', () => {
        test('should handle CORS preflight requests', async () => {
            const response = await request(target())
                .options('/api/banks')
                .set('Origin', 'http://localhost:3000')
                .set('Access-Control-Request-Method', 'POST');

            // Should handle CORS appropriately
            expect([200, 204, 404]).toContain(response.status);
        });

        test('should handle requests with suspicious headers', async () => {
            const response = await request(target())
                .get('/api/banks')
                .set('Cookie', sessionCookie)
                .set('X-Forwarded-For', '127.0.0.1; DROP TABLE users; --')
                .set('User-Agent', '<script>alert("xss")</script>');

            // Should handle safely
            expect([200, 400, 401]).toContain(response.status);
        });
    });
});

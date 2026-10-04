/**
 * Unit tests for lib/auth-validation.ts: same rules and messages as the legacy forms and the server
 */
import {
    isValidEmail, isValidUsername, passwordProblem, requireValue, securityQuestionText, validateRegistration,
    type RegistrationInput,
} from '../../lib/auth-validation';

const valid: RegistrationInput = {
    name: 'Asha Rao',
    username: 'asha_rao',
    email: 'asha@example.com',
    password: 'Balance_2026',
    confirmPassword: 'Balance_2026',
    securityQuestion: 'pet',
    securityAnswer: 'rex',
};

describe('passwordProblem', () => {
    test.each([
        ['Ab1_', 'Password must be at least 8 characters long'],
        ['Ab1_'.repeat(16) + 'x', 'Password must be at most 64 characters long'],
        ['ABCDEFG1_', 'Password must contain at least one lowercase letter, or be 16 characters or longer'],
        ['abcdefg1_', 'Password must contain at least one uppercase letter, or be 16 characters or longer'],
        ['Abcdefgh_', 'Password must contain at least one number, or be 16 characters or longer'],
        ['Abcdefgh12', 'Password must contain at least one symbol, or be 16 characters or longer'],
        ['Password@123', 'This password is too common. Choose another.'],
        ['P@ssw0rd!', 'This password is too common. Choose another.'],
        ['iloveyouiloveyou', 'This password is too common. Choose another.'],
    ])('%s -> %s', (password, message) => {
        expect(passwordProblem(password)).toBe(message);
    });

    test.each(['Balance_2026', 'Abcdefg1-', 'Abcdefg1!', 'Abcdefg1 #', 'mango river quietly bicycle', 'sixteen chars ok'])('%s is accepted', password => {
        expect(passwordProblem(password)).toBeNull();
    });

    test('a password may not contain the username', () => {
        expect(passwordProblem('Asha_rao_2026!', 'asha_rao')).toBe('Password must not contain your username');
        expect(passwordProblem('Balance_2026', 'asha_rao')).toBeNull();
    });

    test('counts characters, not bytes, but never more than bcrypt reads (72 bytes)', () => {
        expect(passwordProblem('पासवर्ड बहुत लंबा है अब')).toBeNull();
        expect(passwordProblem('पासवर्ड'.repeat(5))).toBe('Password must be at most 64 characters long');
    });
});

describe('field checks', () => {
    test('username allows letters, numbers and underscores only', () => {
        expect(isValidUsername('asha_rao2')).toBe(true);
        expect(isValidUsername('asha.rao')).toBe(false);
        expect(isValidUsername('asha rao')).toBe(false);
    });

    test('email needs a local part, @ and a dotted domain', () => {
        expect(isValidEmail('a@b.co')).toBe(true);
        expect(isValidEmail('a@b')).toBe(false);
        expect(isValidEmail('a b@c.d')).toBe(false);
    });

    test('requireValue trims and names the empty field', () => {
        expect(requireValue('  x  ', 'Name')).toBe('x');
        expect(() => requireValue('   ', 'Name')).toThrow('Name is required');
    });

    test('security question keys map to their text, unknown keys pass through', () => {
        expect(securityQuestionText('city')).toBe('In what city were you born?');
        expect(securityQuestionText('custom question?')).toBe('custom question?');
    });
});

describe('validateRegistration', () => {
    test('returns trimmed values for a valid form', () => {
        expect(validateRegistration({ ...valid, name: '  Asha Rao ' }).name).toBe('Asha Rao');
    });

    test.each<[Partial<RegistrationInput>, string]>([
        [{ name: '' }, 'Name is required'],
        [{ email: 'not-an-email' }, 'Please enter a valid email address'],
        [{ password: 'weak', confirmPassword: 'weak' }, 'Password must be at least 8 characters long'],
        [{ password: 'Asha_rao_2026', confirmPassword: 'Asha_rao_2026' }, 'Password must not contain your username'],
        [{ confirmPassword: 'Balance_2027' }, 'Passwords do not match'],
        [{ username: 'asha.rao' }, 'Username can only contain letters, numbers, and underscores'],
        [{ securityAnswer: 'x' }, 'Security answer must be at least 2 characters long'],
    ])('rejects %p with "%s"', (change, message) => {
        expect(() => validateRegistration({ ...valid, ...change })).toThrow(message);
    });
});

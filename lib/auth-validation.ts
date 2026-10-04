import { isCommonPassword } from './common-passwords';

/**
 * Checks shared by the auth forms and the server, so both give the same messages. The forms use
 * them for faster feedback; the server always checks again.
 */

export const SECURITY_QUESTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'pet', label: 'What was the name of your first pet?' },
    { value: 'school', label: 'What was the name of your elementary school?' },
    { value: 'city', label: 'In what city were you born?' },
    { value: 'mother', label: 'What is your mother\'s maiden name?' },
    { value: 'car', label: 'What was the make of your first car?' },
    { value: 'street', label: 'What street did you grow up on?' },
];

/** The question text for a stored key; unknown keys are shown as-is (like the legacy app) */
export function securityQuestionText(key: string): string {
    return SECURITY_QUESTIONS.find(question => question.value === key)?.label ?? key;
}

export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUsername(username: string): boolean {
    return /^[a-zA-Z0-9_]+$/.test(username);
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
/** From this length on, a password is a passphrase: any characters, no required mix */
export const PASSPHRASE_LENGTH = 16;

/**
 * Returns the first problem with the password, or null if it is acceptable. 8 to 64 characters, of
 * any kind (spaces too). Shorter than 16, it needs an uppercase and a lowercase letter, a number and
 * a symbol; from 16 on, a passphrase of plain words is fine. Common passwords are refused, and so is
 * one containing the username. The server also refuses passwords known from data breaches
 * (lib/breached-password.ts).
 */
export function passwordProblem(password: string, username = ''): string | null {
    const length = [...password].length;
    if (length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters long`;
    // bcrypt reads only the first 72 bytes, so longer passwords would be cut silently
    if (length > PASSWORD_MAX || new TextEncoder().encode(password).length > 72) {
        return `Password must be at most ${PASSWORD_MAX} characters long`;
    }
    if (length < PASSPHRASE_LENGTH) {
        if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter, or be 16 characters or longer';
        if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter, or be 16 characters or longer';
        if (!/[0-9]/.test(password)) return 'Password must contain at least one number, or be 16 characters or longer';
        if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one symbol, or be 16 characters or longer';
    }
    const simple = password.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Also with the usual swaps undone, so "P@ssw0rd!" counts as "password"
    const unswapped = password.toLowerCase().replace(/@/g, 'a').replace(/\$/g, 's').replace(/[^a-z0-9]/g, '')
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
    if (isCommonPassword(simple) || isCommonPassword(unswapped)) return 'This password is too common. Choose another.';
    if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
        return 'Password must not contain your username';
    }
    return null;
}

/** Trimmed value, or an error naming the field when it is empty */
export function requireValue(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${fieldName} is required`);
    }
    return trimmed;
}

export interface RegistrationInput {
    name: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
    securityQuestion: string;
    securityAnswer: string;
}

/** Validates in the same order as the legacy form; throws the first problem found */
export function validateRegistration(raw: RegistrationInput): RegistrationInput {
    const data: RegistrationInput = {
        name: requireValue(raw.name, 'Name'),
        username: requireValue(raw.username, 'Username'),
        email: requireValue(raw.email, 'Email'),
        password: requireValue(raw.password, 'Password'),
        confirmPassword: requireValue(raw.confirmPassword, 'Confirm Password'),
        securityQuestion: requireValue(raw.securityQuestion, 'Security Question'),
        securityAnswer: requireValue(raw.securityAnswer, 'Security Answer'),
    };
    if (!isValidEmail(data.email)) {
        throw new Error('Please enter a valid email address');
    }
    const problem = passwordProblem(data.password, data.username);
    if (problem) {
        throw new Error(problem);
    }
    if (data.password !== data.confirmPassword) {
        throw new Error('Passwords do not match');
    }
    if (!isValidUsername(data.username)) {
        throw new Error('Username can only contain letters, numbers, and underscores');
    }
    if (data.securityAnswer.length < 2) {
        throw new Error('Security answer must be at least 2 characters long');
    }
    return data;
}

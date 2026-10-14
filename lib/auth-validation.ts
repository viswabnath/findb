import { isCommonPassword } from './common-passwords';
import { t } from './i18n';
import type { en } from '../messages/en';

/**
 * Checks shared by the auth forms and the server, so both give the same messages. The forms use
 * them for faster feedback; the server always checks again.
 */

const QUESTION_KEYS = ['pet', 'school', 'city', 'mother', 'car', 'street'] as const;

export const SECURITY_QUESTIONS: ReadonlyArray<{ value: string; label: string }> =
    QUESTION_KEYS.map(value => ({ value, label: t(`validation.questions.${value}`) }));

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
    if (length < PASSWORD_MIN) return t('validation.password.tooShort', { min: PASSWORD_MIN });
    // bcrypt reads only the first 72 bytes, so longer passwords would be cut silently
    if (length > PASSWORD_MAX || new TextEncoder().encode(password).length > 72) {
        return t('validation.password.tooLong', { max: PASSWORD_MAX });
    }
    if (length < PASSPHRASE_LENGTH) {
        if (!/[a-z]/.test(password)) return t('validation.password.lowercase');
        if (!/[A-Z]/.test(password)) return t('validation.password.uppercase');
        if (!/[0-9]/.test(password)) return t('validation.password.number');
        if (!/[^A-Za-z0-9]/.test(password)) return t('validation.password.symbol');
    }
    const simple = password.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Also with the usual swaps undone, so "P@ssw0rd!" counts as "password"
    const unswapped = password.toLowerCase().replace(/@/g, 'a').replace(/\$/g, 's').replace(/[^a-z0-9]/g, '')
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
    if (isCommonPassword(simple) || isCommonPassword(unswapped)) return t('validation.password.common');
    if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
        return t('validation.password.hasUsername');
    }
    return null;
}

export type FieldName = keyof typeof en.validation.fields;

/** Trimmed value, or an error naming the field when it is empty */
export function requireValue(value: string, field: FieldName): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(t('validation.required', { field: t(`validation.fields.${field}`) }));
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
        name: requireValue(raw.name, 'name'),
        username: requireValue(raw.username, 'username'),
        email: requireValue(raw.email, 'email'),
        password: requireValue(raw.password, 'password'),
        confirmPassword: requireValue(raw.confirmPassword, 'confirmPassword'),
        securityQuestion: requireValue(raw.securityQuestion, 'securityQuestion'),
        securityAnswer: requireValue(raw.securityAnswer, 'securityAnswer'),
    };
    if (!isValidEmail(data.email)) {
        throw new Error(t('validation.email'));
    }
    const problem = passwordProblem(data.password, data.username);
    if (problem) {
        throw new Error(problem);
    }
    if (data.password !== data.confirmPassword) {
        throw new Error(t('validation.passwordsDiffer'));
    }
    if (!isValidUsername(data.username)) {
        throw new Error(t('validation.username'));
    }
    if (data.securityAnswer.length < 2) {
        throw new Error(t('validation.securityAnswer'));
    }
    return data;
}

/**
 * Unit tests for lib/totp.ts, against the RFC 6238 test values (SHA-1, secret "12345678901234567890")
 */
import { base32Decode, base32Encode, newTotpSecret, otpauthUri, totpCode, totpStep, verifyTotp } from '../../lib/totp';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totpCode', () => {
    // RFC 6238 appendix B gives 8 digits; authenticator apps use the last 6
    test.each([
        [59, '94287082'],
        [1111111109, '07081804'],
        [1111111111, '14050471'],
        [1234567890, '89005924'],
        [2000000000, '69279037'],
        [20000000000, '65353130'],
    ])('at %i seconds', (seconds, eightDigits) => {
        expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(eightDigits.slice(-6));
    });
});

describe('base32', () => {
    test('round-trips, ignoring case, spaces and padding', () => {
        const bytes = Buffer.from('FinDB secret bytes!');
        const text = base32Encode(bytes);
        expect(base32Decode(text.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(bytes);
        expect(base32Decode('JBSWY3DPEHPK3PXP====')).toEqual(Buffer.from('Hello!\xde\xad\xbe\xef', 'latin1'));
    });

    test('refuses characters outside the alphabet', () => {
        expect(() => base32Decode('ABC1')).toThrow('Not a base32 secret');
    });

    test('new secrets are 160 bits and differ', () => {
        const secret = newTotpSecret();
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(newTotpSecret()).not.toBe(secret);
    });
});

describe('verifyTotp', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);

    test('accepts the current code and one step either side, and says which step', () => {
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), null, now)).toBe(step);
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now)).toBeNull();
    });

    test('refuses a code from a step already used, or earlier', () => {
        const code = totpCode(RFC_SECRET, step);
        expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
        expect(verifyTotp(RFC_SECRET, code, step - 1, now)).toBe(step);
        expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), step - 1, now)).toBeNull();
    });

    test('allows spaces, refuses anything but six digits', () => {
        const code = totpCode(RFC_SECRET, step);
        expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, null, now)).toBe(step);
        expect(verifyTotp(RFC_SECRET, code.slice(0, 5), null, now)).toBeNull();
        expect(verifyTotp(RFC_SECRET, 'abcdef', null, now)).toBeNull();
    });
});

test('otpauthUri names FinDB and the account', () => {
    expect(otpauthUri('ABCD', 'asha_rao')).toBe('otpauth://totp/FinDB%3Aasha_rao?secret=ABCD&issuer=FinDB&algorithm=SHA1&digits=6&period=30');
});

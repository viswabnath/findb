/**
 * Unit tests for field encryption, the breached-password check and the device description
 */
import { decryptField, encryptField, needsReencryption } from '../../lib/field-encryption';
import { isBreachedPassword } from '../../lib/breached-password';
import { describeUserAgent } from '../../lib/services/security';

const KEY_1 = Buffer.alloc(32, 1).toString('base64');
const KEY_2 = Buffer.alloc(32, 2).toString('base64');

describe('field encryption', () => {
    const saved = process.env.FIELD_ENCRYPTION_KEYS;
    afterEach(() => { process.env.FIELD_ENCRYPTION_KEYS = saved; });

    test('round-trips, with a new random IV each time', () => {
        process.env.FIELD_ENCRYPTION_KEYS = `1:${KEY_1}`;
        const first = encryptField('JBSWY3DPEHPK3PXP', 'users.totp_secret:7');
        expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(first).not.toContain('JBSWY3DPEHPK3PXP');
        expect(encryptField('JBSWY3DPEHPK3PXP', 'users.totp_secret:7')).not.toBe(first);
        expect(decryptField(first, 'users.totp_secret:7')).toBe('JBSWY3DPEHPK3PXP');
    });

    test('a value copied to another user, or changed, does not decrypt', () => {
        process.env.FIELD_ENCRYPTION_KEYS = `1:${KEY_1}`;
        const value = encryptField('secret', 'users.totp_secret:7');
        expect(() => decryptField(value, 'users.totp_secret:8')).toThrow();
        const [version, iv, tag, data] = value.split('.');
        const flipped = Buffer.from(data!, 'base64url');
        flipped[0]! ^= 1;
        expect(() => decryptField([version, iv, tag, flipped.toString('base64url')].join('.'), 'users.totp_secret:7')).toThrow();
    });

    test('a new key in front encrypts new values; older values still decrypt', () => {
        process.env.FIELD_ENCRYPTION_KEYS = `1:${KEY_1}`;
        const old = encryptField('secret', 'ctx');
        process.env.FIELD_ENCRYPTION_KEYS = `2:${KEY_2},1:${KEY_1}`;
        expect(decryptField(old, 'ctx')).toBe('secret');
        expect(needsReencryption(old)).toBe(true);
        const fresh = encryptField('secret', 'ctx');
        expect(fresh.startsWith('v2.')).toBe(true);
        expect(needsReencryption(fresh)).toBe(false);
    });

    test('refuses to run without a valid key', () => {
        delete process.env.FIELD_ENCRYPTION_KEYS;
        expect(() => encryptField('x', 'ctx')).toThrow('FIELD_ENCRYPTION_KEYS is not set');
        process.env.FIELD_ENCRYPTION_KEYS = '1:short';
        expect(() => encryptField('x', 'ctx')).toThrow('32-byte keys');
    });
});

describe('isBreachedPassword', () => {
    // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fakeFetch = (body: string, ok = true) => jest.fn(async () => ({ ok, text: async () => body })) as unknown as typeof fetch;

    test('sends only the first five characters of the hash, and finds the rest in the answer', async () => {
        const fetcher = fakeFetch('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n');
        expect(await isBreachedPassword('password', fetcher)).toBe(true);
        expect((fetcher as unknown as jest.Mock).mock.calls[0][0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    });

    test('padding entries (count 0) and other hashes do not match', async () => {
        expect(await isBreachedPassword('password', fakeFetch('1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\n'))).toBe(false);
        expect(await isBreachedPassword('password', fakeFetch('0018A45C4D1DEF81644B54AB7F969B88D65:1\n'))).toBe(false);
    });

    test('lets the password through when the service fails or is turned off', async () => {
        expect(await isBreachedPassword('password', fakeFetch('', false))).toBe(false);
        expect(await isBreachedPassword('password', jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
        process.env.BREACHED_PASSWORD_CHECK = 'false';
        const fetcher = fakeFetch('1E4C9B93F3F0682250B6CF8331B7EE68FD8:5\n');
        expect(await isBreachedPassword('password', fetcher)).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        delete process.env.BREACHED_PASSWORD_CHECK;
    });
});

describe('describeUserAgent', () => {
    test.each([
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Chrome on Windows'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
        ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 EdgA/129.0', 'Chrome on Android'],
        ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge on Windows'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Mac'],
        [null, 'Unknown device'],
    ])('%s', (ua, expected) => {
        expect(describeUserAgent(ua)).toBe(expected);
    });
});

describe('profile masking', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { maskId, isValidPan } = require('../../lib/services/profile');

    test('shows the first two and last two characters', () => {
        expect(maskId('ABCDE1234F')).toBe('AB******4F');
        expect(maskId('AB12')).toBe('****');
    });

    test('PAN format', () => {
        expect(isValidPan('ABCDE1234F')).toBe(true);
        expect(isValidPan('ABCDE12345')).toBe(false);
    });
});

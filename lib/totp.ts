import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time codes (TOTP, RFC 6238) for two-factor login, as Google Authenticator,
 * Microsoft Authenticator and other apps make them: HMAC-SHA1, 6 digits, a new code every 30
 * seconds. Free and offline: no SMS and no outside service.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

export function base32Decode(text: string): Buffer {
    const clean = text.toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const char of clean) {
        const index = BASE32.indexOf(char);
        if (index < 0) throw new Error('Not a base32 secret');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32 */
export function newTotpSecret(): string {
    return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in */
export function totpStep(nowMs = Date.now()): number {
    return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** The code for a step */
export function totpCode(secret: string | Buffer, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = createHmac('sha1', typeof secret === 'string' ? base32Decode(secret) : secret).update(counter).digest();
    const offset = hmac[hmac.length - 1]! & 15;
    const number = hmac.readUInt32BE(offset) & 0x7fffffff;
    return String(number % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The step a code matches, or null. One step either side is accepted, for a phone clock that is a
 * little off. A code from a step at or before `lastUsedStep` is refused, so a code seen by someone
 * else cannot be used again.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null, nowMs = Date.now()): number | null {
    const given = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(given)) return null;
    const now = totpStep(nowMs);
    for (const step of [now - 1, now, now + 1]) {
        if (lastUsedStep !== null && step <= lastUsedStep) continue;
        if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(given))) return step;
    }
    return null;
}

/** The link an authenticator app reads from the QR code */
export function otpauthUri(secret: string, account: string): string {
    const label = encodeURIComponent(`FinDB:${account}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=FinDB&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

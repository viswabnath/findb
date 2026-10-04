import { createHash } from 'crypto';

/**
 * Whether a password appears in known data breaches, from the free Pwned Passwords service
 * (api.pwnedpasswords.com). The password never leaves the server: only the first 5 characters of
 * its SHA-1 hash are sent, and the service returns every breached hash starting with them, among
 * which the match is found here (k-anonymity). Padding hides how many results came back.
 *
 * If the service is slow or down, the check is skipped rather than blocking sign-up (fail open):
 * the length, mix and common-password rules still apply. BREACHED_PASSWORD_CHECK=false turns it
 * off (the test servers do, so tests never depend on an outside service).
 */

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2500;

export async function isBreachedPassword(password: string, fetcher: typeof fetch = fetch): Promise<boolean> {
    if (process.env.BREACHED_PASSWORD_CHECK === 'false') return false;
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    try {
        const response = await fetcher(RANGE_URL + prefix, {
            headers: { 'Add-Padding': 'true', 'User-Agent': 'FinDB password check' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const body = await response.text();
        return body.split('\n').some(line => {
            const [candidate, count] = line.trim().split(':');
            return candidate === suffix && Number(count) > 0;
        });
    } catch {
        return false;
    }
}

export const BREACHED_PASSWORD_MESSAGE = 'This password has appeared in a data breach, so attackers try it first. Choose another.';

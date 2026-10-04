/**
 * The security headers in next.config.ts (they moved from vercel.json and Helmet in N4)
 */
import nextConfig, { API_CONTENT_SECURITY_POLICY, SECURITY_HEADERS, SITE_CONTENT_SECURITY_POLICY } from '../../next.config';
import { SITE_ROUTES } from '../../lib/site-routes';
import { config as proxyConfig } from '../../proxy';

describe('security headers', () => {
    test('every response gets the standard headers', async () => {
        const rules = await nextConfig.headers!();
        const all = rules.find(rule => rule.source === '/:path*');
        expect(all?.headers).toEqual(SECURITY_HEADERS);
        const byKey = Object.fromEntries(SECURITY_HEADERS.map(header => [header.key, header.value]));
        expect(byKey).toEqual({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
            'Referrer-Policy': 'no-referrer',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Cross-Origin-Opener-Policy': 'same-origin',
        });
    });

    test('API responses get a policy that allows nothing', async () => {
        const rules = await nextConfig.headers!();
        const api = rules.find(rule => rule.source === '/api/:path*');
        expect(api?.headers).toEqual([{ key: 'Content-Security-Policy', value: API_CONTENT_SECURITY_POLICY }]);
    });

    test('a fixed page policy only ever covers the static website pages, never an app page', async () => {
        // A second Content-Security-Policy on an app page would block its nonce scripts
        const rules = await nextConfig.headers!();
        const withPolicy = rules.filter(rule => rule.headers.some(header => header.key === 'Content-Security-Policy'));
        const pageRules = withPolicy.filter(rule => rule.source !== '/api/:path*');
        expect(pageRules.map(rule => rule.source).sort()).toEqual([...SITE_ROUTES].sort());
        for (const rule of pageRules) expect(rule.headers).toEqual([{ key: 'Content-Security-Policy', value: SITE_CONTENT_SECURITY_POLICY }]);
        const appPages = proxyConfig.matcher.filter((entry): entry is string => typeof entry === 'string');
        for (const page of appPages) expect(pageRules.map(rule => rule.source)).not.toContain(page);
    });

    test('the X-Powered-By header is off', () => {
        expect(nextConfig.poweredByHeader).toBe(false);
    });
});

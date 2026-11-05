/**
 * The security headers in next.config.ts (they moved from vercel.json and Helmet in N4)
 */
import nextConfig, {
    API_CONTENT_SECURITY_POLICY, OCR_CONTENT_SECURITY_POLICY, SECURITY_HEADERS, SERVICE_WORKER_CONTENT_SECURITY_POLICY, SITE_CONTENT_SECURITY_POLICY,
} from '../../next.config';
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
        const pageRules = withPolicy.filter(rule => !['/api/:path*', '/ocr/:path*', '/sw.js'].includes(rule.source));
        expect(pageRules.map(rule => rule.source).sort()).toEqual([...SITE_ROUTES].sort());
        for (const rule of pageRules) expect(rule.headers).toEqual([{ key: 'Content-Security-Policy', value: SITE_CONTENT_SECURITY_POLICY }]);
        const appPages = proxyConfig.matcher.filter((entry): entry is string => typeof entry === 'string');
        for (const page of appPages) expect(pageRules.map(rule => rule.source)).not.toContain(page);
    });

    test('only the receipt reader\'s files may compile WebAssembly, and they are cached for good', async () => {
        const rules = await nextConfig.headers!();
        const ocr = rules.find(rule => rule.source === '/ocr/:path*');
        expect(ocr?.headers).toEqual([
            { key: 'Content-Security-Policy', value: OCR_CONTENT_SECURITY_POLICY },
            { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ]);
        expect(OCR_CONTENT_SECURITY_POLICY).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'");
        for (const rule of rules.filter(item => item.source !== '/ocr/:path*')) {
            for (const header of rule.headers) expect(header.value).not.toContain('wasm-unsafe-eval');
        }
    });

    test('the service worker may only reach FinDB itself, and is never cached', async () => {
        const rules = await nextConfig.headers!();
        expect(rules.find(rule => rule.source === '/sw.js')?.headers).toEqual([
            { key: 'Content-Security-Policy', value: SERVICE_WORKER_CONTENT_SECURITY_POLICY },
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ]);
        expect(SERVICE_WORKER_CONTENT_SECURITY_POLICY).toBe("default-src 'self'; frame-ancestors 'none'");
    });

    test('the X-Powered-By header is off', () => {
        expect(nextConfig.poweredByHeader).toBe(false);
    });
});

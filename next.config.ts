import type { NextConfig } from 'next';
import { buildSiteContentSecurityPolicy } from './lib/csp';
import { SITE_ROUTES } from './lib/site-routes';

/**
 * Security headers for every response, and the Content-Security-Policy:
 *   - the app's pages get a per-request nonce policy from proxy.ts;
 *   - the static website pages (lib/site-routes.ts) get a fixed policy from here;
 *   - API responses are JSON or CSV and never render, so they get a policy that allows nothing.
 * Vercel serves HTTPS only, so no HTTP-to-HTTPS redirect is needed here.
 * tests/unit/security-headers.test.ts checks this list.
 */
export const SECURITY_HEADERS = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

export const SITE_CONTENT_SECURITY_POLICY = buildSiteContentSecurityPolicy({ isDevelopment: process.env.NODE_ENV === 'development' });

const nextConfig: NextConfig = {
    poweredByHeader: false,
    experimental: {
        // The website and the app have separate root layouts, so unmatched addresses need a
        // standalone 404 page (app/global-not-found.tsx)
        globalNotFound: true,
        // An integrity hash on every Next.js script, so a changed file is refused by the browser
        sri: { algorithm: 'sha256' },
    },
    async headers() {
        return [
            { source: '/:path*', headers: SECURITY_HEADERS },
            { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: API_CONTENT_SECURITY_POLICY }] },
            ...SITE_ROUTES.map(source => ({ source, headers: [{ key: 'Content-Security-Policy', value: SITE_CONTENT_SECURITY_POLICY }] })),
        ];
    },
};

export default nextConfig;

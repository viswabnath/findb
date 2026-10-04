/**
 * The website's pages (app/(site)), in the proxy matcher's syntax. They are static: built at deploy
 * time and served from the CDN, so proxy.ts does not run for them and next.config.ts gives them a
 * fixed Content-Security-Policy instead of a per-request nonce. tests/unit/routing.test.ts checks
 * that this list matches the pages in app/(site).
 */
export const SITE_ROUTES = [
    '/',
    '/about',
    '/download',
    '/faq',
    '/features',
    '/features/:slug',
    '/privacy',
    '/roadmap',
    '/security',
    '/terms',
    '/tools',
    '/tools/:slug',
] as const;

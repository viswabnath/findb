/**
 * The two kinds of page get their Content-Security-Policy in different ways:
 *   - the app's pages (app/(product)) from proxy.ts, with a per-request nonce, so the proxy matcher
 *     has to list exactly those pages;
 *   - the website's pages (app/(site)) are static and get a fixed policy from next.config.ts, so
 *     lib/site-routes.ts has to list exactly those, and the proxy must not run for them.
 * API routes are matched by neither: they are JSON and get a deny-all policy from next.config.ts.
 */
import fs from 'fs';
import path from 'path';
import { config } from '../../proxy';
import nextConfig, { SITE_CONTENT_SECURITY_POLICY } from '../../next.config';
import { SITE_ROUTES } from '../../lib/site-routes';

const root = path.join(__dirname, '..', '..');

function findFiles(dir: string, name: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return findFiles(full, name);
        return entry.name === name ? [full] : [];
    });
}

/**
 * app/(site)/about/page.tsx -> /about (route groups in parentheses are not part of the URL), and
 * app/(site)/features/[slug]/page.tsx -> /features/:slug (the matcher's syntax)
 */
function toRoute(file: string): string {
    const segments = path.relative(path.join(root, 'app'), path.dirname(file)).split(path.sep)
        .filter(segment => segment && !/^\(.*\)$/.test(segment))
        .map(segment => segment.replace(/^\[(\w+)\]$/, ':$1'));
    return '/' + segments.join('/');
}

const pagesIn = (group: string) => findFiles(path.join(root, 'app', group), 'page.tsx').map(toRoute).sort();
const handlerRoutes = findFiles(path.join(root, 'app'), 'route.ts').map(toRoute).sort();
const matcherPaths = config.matcher.filter((entry): entry is string => typeof entry === 'string').sort();

describe('routing', () => {
    test('the proxy matcher lists exactly the app pages', () => {
        expect(matcherPaths).toEqual(pagesIn('(product)'));
    });

    test('the proxy runs on the home page only for old /?section= links', () => {
        const home = config.matcher.filter(entry => typeof entry !== 'string');
        expect(home).toEqual([{ source: '/', has: [{ type: 'query', key: 'section' }] }]);
    });

    test('lib/site-routes.ts lists exactly the website pages, and none of them goes through the proxy', () => {
        expect([...SITE_ROUTES].sort()).toEqual(pagesIn('(site)'));
        for (const route of SITE_ROUTES) expect(matcherPaths).not.toContain(route);
    });

    test('every website page gets the fixed website policy from next.config.ts', async () => {
        const rules = await nextConfig.headers!();
        for (const route of SITE_ROUTES) {
            const rule = rules.find(candidate => candidate.source === route);
            expect(rule?.headers).toEqual([{ key: 'Content-Security-Policy', value: SITE_CONTENT_SECURITY_POLICY }]);
        }
    });

    test('API route handlers are not matched by the proxy', () => {
        const apiRoutes = handlerRoutes.filter(route => route.startsWith('/api/'));
        expect(apiRoutes.length).toBeGreaterThan(0);
        expect(matcherPaths.filter(route => route.startsWith('/api'))).toEqual([]);
    });

    test('vercel.json is a plain Next.js project (no services or rewrites since N4)', () => {
        const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
        expect(vercel.framework).toBe('nextjs');
        expect(vercel.services).toBeUndefined();
        expect(vercel.rewrites).toBeUndefined();
    });

    test('vercel.json builds production only: every preview build is skipped', () => {
        const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
        // Vercel skips the build when the ignore command exits 0, and builds when it exits 1
        expect(vercel.ignoreCommand).toBe('if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi');
    });
});

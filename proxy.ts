import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, createNonce } from './lib/csp';

/**
 * Runs only for the app's pages (app/(product)): gives each one a per-request nonce
 * Content-Security-Policy, and sends visitors without a session cookie from the logged-in screens
 * to /login. It also redirects old links into the former single-page app (/?section=...).
 *
 * It does not run for the website's pages: they are static, served from the CDN, and get a fixed
 * policy from next.config.ts (lib/site-routes.ts), so a website visit costs no function call. API
 * routes are not matched either: next.config.ts gives them a deny-all policy.
 * tests/unit/routing.test.ts checks that the matcher lists exactly the app's pages.
 */
/** Logged-in screens served by Next.js; visitors without a session cookie go to /login */
const APP_PATHS = new Set(['/setup', '/transactions', '/summary', '/activity']);
/** The session cookie (lib/session.ts) */
const SESSION_COOKIE = 'sessionId';
/** Old links into the former single-page app (/?section=...) and where those screens live now */
const SECTION_PATHS: Record<string, string> = {
    setup: '/setup', transactions: '/transactions', summary: '/summary', activity: '/activity',
};

export function proxy(request: NextRequest) {
    const section = request.nextUrl.searchParams.get('section');
    if (request.nextUrl.pathname === '/' && section !== null) {
        const target = !request.cookies.has(SESSION_COOKIE) ? '/login'
            : Object.prototype.hasOwnProperty.call(SECTION_PATHS, section) ? SECTION_PATHS[section]! : '/setup';
        return NextResponse.redirect(new URL(target, request.url));
    }

    if (APP_PATHS.has(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE)) {
        // Cheap check only: an expired or invalid session is caught by the page's first API call (401)
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const nonce = createNonce();
    const csp = buildContentSecurityPolicy({
        nonce,
        isDevelopment: process.env.NODE_ENV === 'development',
        isHttps: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    });

    // Next.js reads the nonce from the request's CSP header and applies it to its scripts
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
}

export const config = {
    matcher: [
        // The home page only when it is an old /?section=... link
        { source: '/', has: [{ type: 'query', key: 'section' }] },
        '/login',
        '/register',
        '/forgot-username',
        '/forgot-password',
        '/welcome',
        '/setup',
        '/transactions',
        '/summary',
        '/activity',
    ],
};

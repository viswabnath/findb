/**
 * Content-Security-Policy for pages rendered by Next.js. Framework-free so it can be unit tested.
 *
 * Next.js needs inline scripts to load pages, so instead of the legacy app's
 * `script-src 'self'` policy each response gets a fresh nonce. Next.js reads the nonce from
 * the request's CSP header and adds it to its own scripts. 'strict-dynamic' lets scripts that
 * carry the nonce load the page's other chunks.
 */

export interface CspOptions {
    /** Base64 nonce, unique per response */
    nonce: string;
    /** React development builds use eval for debugging */
    isDevelopment: boolean;
    /** Only upgrade insecure requests over HTTPS: Safari applies it to http://localhost too */
    isHttps: boolean;
}

export function buildContentSecurityPolicy({ nonce, isDevelopment, isHttps }: CspOptions): string {
    const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
    if (isDevelopment) {
        scriptSrc.push("'unsafe-eval'");
    }

    const directives = [
        "default-src 'self'",
        `script-src ${scriptSrc.join(' ')}`,
        "script-src-attr 'none'",
        // Inline style attributes are still used by the ported legacy markup
        "style-src 'self' 'unsafe-inline'",
        // Fonts are self-hosted by next/font
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
    ];
    if (isHttps) {
        directives.push('upgrade-insecure-requests');
    }
    return directives.join('; ');
}

/** A random nonce for one response (Web Crypto, available in Node 20+ and the proxy runtime) */
export function createNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
}

/**
 * Content-Security-Policy for the static website pages (lib/site-routes.ts). Static pages cannot
 * carry a per-request nonce, and Next.js puts two small inline scripts on every page (its page
 * data), so inline scripts are allowed here. That is acceptable because these pages hold no
 * personal data and show no user input; everything else stays locked down, and every external
 * script carries an integrity hash (experimental.sri in next.config.ts). The app's pages keep the
 * strict nonce policy above.
 */
export function buildSiteContentSecurityPolicy({ isDevelopment }: { isDevelopment: boolean }): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
    ].join('; ');
}

import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Poppins, Source_Sans_3 } from 'next/font/google';
import { SiteHeader } from '@/components/site/SiteHeader';
import { MarketingFooter } from '@/components/site/MarketingFooter';
import { SITE_URL } from '@/lib/site-url';
import './site.css';

// Self-hosted at build time, so the page CSP's font-src 'self' is enough
// Poppins (Indian Type Foundry) for headings; Source Sans 3 for text
const head = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-head' });
const body = Source_Sans_3({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: { default: 'FinDB: your family\'s money, in one honest picture', template: '%s | FinDB' },
    description:
        'FinDB is a free personal finance dashboard made for India. Track bank accounts, cards, cash, loans, gold, property and savings in plain language. No ads, and your data is never sold.',
    applicationName: 'FinDB',
    appleWebApp: { capable: true, title: 'FinDB', statusBarStyle: 'default' },
    openGraph: { type: 'website', siteName: 'FinDB', locale: 'en_IN' },
    twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#07130e' },
    ],
};

/**
 * The root layout of the website (home, features, tools, security, roadmap and the other public
 * pages). The app has its own root layout in app/(product), so the two stylesheets never mix.
 *
 * Every website page is static: built once and served from the CDN, which is fast for visitors and
 * search engines and costs no function call per visit. So nothing here reads the request; the
 * header learns from a cookie in the browser whether someone is signed in. These pages get their
 * Content-Security-Policy from next.config.ts (no nonce), and proxy.ts does not run for them.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en-IN" className={`${head.variable} ${body.variable}`}>
            <body className="site">
                <a className="skip-link" href="#main">Skip to content</a>
                <SiteHeader />
                <main id="main">{children}</main>
                <MarketingFooter />
            </body>
        </html>
    );
}

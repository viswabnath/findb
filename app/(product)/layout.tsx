import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { Poppins, Source_Sans_3 } from 'next/font/google';
import { ToastProvider } from '@/components/Toast';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './app.css';

// Self-hosted at build time (no request to Google at runtime, so CSP font-src 'self' is enough)
const head = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-head' });
const body = Source_Sans_3({ subsets: ['latin'], variable: '--font-body' });

export const metadata = {
    title: 'FinDB',
    description: 'A personal finance dashboard for India',
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#07130e' },
    ],
};

/**
 * The root layout of the app: the sign-in screens and the logged-in screens. The website has its
 * own root layout (app/(site)/layout.tsx), so moving between the two is a full page load and
 * neither stylesheet leaks into the other.
 *
 * Every page renders per request: each response carries a fresh CSP nonce (see proxy.ts),
 * and reading the request headers opts into dynamic rendering.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
    await headers();
    // Light or dark when the user chose one in Settings; otherwise the device's setting decides (app.css)
    const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
    return (
        <html lang="en-IN" className={`${head.variable} ${body.variable}`} data-theme={theme === 'system' ? undefined : theme}>
            <body>
                <ToastProvider>{children}</ToastProvider>
            </body>
        </html>
    );
}

import { ImageResponse } from 'next/og';

/** The size every link preview image is drawn at (the common 1.91:1 card) */
export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The link preview image shown when a FinDB page is shared on WhatsApp, X, LinkedIn and the like:
 * the logo, a title and a line of text on FinDB green. Drawn once at build time.
 * (The built-in font has no rupee sign, so titles here avoid it.)
 */
export function ogImage({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
    return new ImageResponse(
        (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0b3d2c', color: '#ffffff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <svg width="72" height="72" viewBox="0 0 64 64">
                        <rect width="64" height="64" rx="15" fill="#0f8a5f" />
                        <path d="M21 50 V15 H44 M21 31 H44" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                        <rect x="37" y="41" width="9" height="9" rx="1.5" fill="#e8a531" />
                    </svg>
                    <span style={{ fontSize: 44, fontWeight: 700 }}>FinDB</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <span style={{ fontSize: 28, color: '#e8a531', fontWeight: 700 }}>{eyebrow}</span>
                    <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>{title}</span>
                    <span style={{ fontSize: 30, color: '#b5d6c7', maxWidth: 980 }}>{text}</span>
                </div>
                <span style={{ fontSize: 26, color: '#b5d6c7' }}>Free for everyone. No ads. Made in India.</span>
            </div>
        ),
        OG_SIZE,
    );
}

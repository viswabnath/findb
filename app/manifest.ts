import type { MetadataRoute } from 'next';

/**
 * The web app manifest: lets phones, tablets and computers install FinDB from the browser
 * ("Add to Home screen" / "Install app"). The installed app opens on the app's first screen;
 * signed-out visitors are sent to /login by proxy.ts. Installed, it is also a share target.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'FinDB',
        short_name: 'FinDB',
        description: 'Your family\'s money, in one honest picture. A free personal finance dashboard made for India.',
        start_url: '/setup',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#0f8a5f',
        lang: 'en-IN',
        categories: ['finance', 'productivity'],
        // Share to FinDB: a bank SMS, a receipt photo, a UPI screenshot or a statement file from any
        // app; the service worker (public/sw.js) keeps it on the phone and opens /share
        share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
                title: 'title', text: 'text', url: 'url',
                files: [{ name: 'file', accept: ['image/*', 'application/pdf', 'text/csv', '.csv', '.xls', '.xlsx', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] }],
            },
        },
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}

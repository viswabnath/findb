'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { ENTRIES_CHANGED } from '@/components/app/QuickAdd';
import { t } from '@/lib/i18n';
import { QUEUE_CHANGED, queuedEntries, sendQueued } from '@/lib/offline-queue';

/**
 * The phone app's connection state (v2 Phase 5): registers the service worker (public/sw.js), says
 * when the app is offline and how many entries wait on this phone, and sends them when the
 * connection is back (and whenever the app opens).
 */
export function OfflineBar({ owner }: { owner: number | null }) {
    const toast = useToast();
    const [online, setOnline] = useState(true);
    const [waiting, setWaiting] = useState(0);

    useEffect(() => {
        if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
            navigator.serviceWorker.register('/sw.js').catch(() => undefined);
        }
        setOnline(navigator.onLine);
        const up = () => setOnline(true);
        const down = () => setOnline(false);
        window.addEventListener('online', up);
        window.addEventListener('offline', down);
        return () => {
            window.removeEventListener('online', up);
            window.removeEventListener('offline', down);
        };
    }, []);

    useEffect(() => {
        if (owner === null) return;
        const count = () => queuedEntries(owner).then(list => setWaiting(list.length), () => setWaiting(0));
        count();
        window.addEventListener(QUEUE_CHANGED, count);
        return () => window.removeEventListener(QUEUE_CHANGED, count);
    }, [owner]);

    // Back online (or the app opened) with entries waiting: send them
    useEffect(() => {
        if (owner === null || !online || waiting === 0) return;
        sendQueued(owner).then(({ sent, refused }) => {
            if (sent > 0) {
                toast('success', t('offline.sent', { count: sent }));
                window.dispatchEvent(new CustomEvent(ENTRIES_CHANGED));
            }
            for (const item of refused) toast('error', t('offline.refused', { label: item.label, error: item.error }));
        }, () => undefined);
        // Runs once per change of connection, or when entries start or stop waiting
    }, [owner, online, waiting > 0]);

    if (online && waiting === 0) return null;
    return (
        <div id="offline-bar" className="notice warn" role="status">
            {online ? t('offline.sending', { count: waiting }) : waiting > 0 ? t('offline.waiting', { count: waiting }) : t('offline.offline')}
        </div>
    );
}

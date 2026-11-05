/**
 * What was shared into FinDB from another app (v2 Phase 5): the service worker (public/sw.js) keeps
 * it in the "findb-share" cache on this phone; the /share screen and Import take it from there.
 * Taking it removes it, so a shared item is used once. Browser only.
 */

export interface SharedItem {
    title: string;
    text: string;
    url: string;
    file: File | null;
}

const CACHE = 'findb-share';

/** The item waiting, or null; `keep` leaves it for the next screen (Import reads the file itself) */
export async function takeShared(keep = false): Promise<SharedItem | null> {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(CACHE);
        const metaResponse = await cache.match('/shared/meta');
        if (!metaResponse) return null;
        const meta = await metaResponse.json() as { title: string; text: string; url: string; file: { name: string; type: string } | null };
        let file: File | null = null;
        if (meta.file) {
            const fileResponse = await cache.match('/shared/file');
            if (fileResponse) file = new File([await fileResponse.blob()], meta.file.name || 'shared', { type: meta.file.type });
        }
        if (!keep) await caches.delete(CACHE);
        return { title: meta.title, text: meta.text, url: meta.url, file };
    } catch {
        return null;
    }
}

/** A statement file (CSV, Excel or PDF), as opposed to a picture to read */
export function isStatementFile(file: File): boolean {
    return /\.(csv|txt|xls|xlsx|pdf)$/i.test(file.name) || ['text/csv', 'application/pdf', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.type);
}

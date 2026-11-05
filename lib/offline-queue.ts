import { apiPost } from './api-client';

/**
 * Entries added without a connection (v2 Phase 5): kept in this browser's IndexedDB and sent when
 * the app is back online. Each carries a reference made here (clientRef), so sending it twice (the
 * first answer lost on a weak connection) never makes a second entry (migration 0036). Each is
 * tagged with the account that added it and only ever sent for that account, so a phone two people
 * share never posts one person's entry into the other's books.
 *
 * Browser only. Nothing here touches the server except POST /api/entries.
 */

export interface QueuedEntry {
    ref: string;
    /** The user id that added it (from /api/user) */
    owner: number;
    body: Record<string, unknown>;
    /** For messages: "Rs 120.00, Groceries" */
    label: string;
    createdAt: string;
}

const DB = 'findb-offline';
const STORE = 'entries';
export const QUEUE_CHANGED = 'findb:offline-queue';

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'ref' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try {
        return await new Promise<T>((resolve, reject) => {
            const request = work(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

const announce = () => window.dispatchEvent(new CustomEvent(QUEUE_CHANGED));

/** Keep an entry to send later; returns its reference */
export async function queueEntry(owner: number, body: Record<string, unknown>, label: string): Promise<string> {
    const ref = crypto.randomUUID();
    await run('readwrite', store => store.put({ ref, owner, body: { ...body, clientRef: ref }, label, createdAt: new Date().toISOString() } satisfies QueuedEntry));
    announce();
    return ref;
}

/** Entries waiting for this account, oldest first */
export async function queuedEntries(owner: number): Promise<QueuedEntry[]> {
    if (typeof indexedDB === 'undefined') return [];
    const all = await run<QueuedEntry[]>('readonly', store => store.getAll() as IDBRequest<QueuedEntry[]>).catch(() => [] as QueuedEntry[]);
    return all.filter(entry => entry.owner === owner).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

let sending: Promise<{ sent: number; refused: { label: string; error: string }[] }> | null = null;

/**
 * Send this account's waiting entries, oldest first. One the server refuses (an account since
 * removed, say) is dropped and reported; one that cannot reach it stays for next time, and so do
 * those after it. Only one send runs at a time.
 */
export function sendQueued(owner: number): Promise<{ sent: number; refused: { label: string; error: string }[] }> {
    sending ??= (async () => {
        let sent = 0;
        const refused: { label: string; error: string }[] = [];
        try {
            for (const entry of await queuedEntries(owner)) {
                const result = await apiPost<{ error?: string }>('/api/entries', entry.body);
                // Offline again, signed out, or the server busy: stop and keep the rest
                if (result.status === 0 || result.status === 401 || result.status === 429 || result.status >= 500) break;
                if (!result.ok) refused.push({ label: entry.label, error: result.data.error ?? '' });
                else sent += 1;
                await run('readwrite', store => store.delete(entry.ref));
            }
        } finally {
            sending = null;
            announce();
        }
        return { sent, refused };
    })();
    return sending;
}

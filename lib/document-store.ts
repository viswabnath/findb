/**
 * Where the document vault's files live (v2 Phase 2; decided 2026-10-14): a private Supabase
 * Storage bucket, reached from the server only with the service role key. Files arrive here
 * already encrypted (lib/field-encryption.ts encryptBytes), so the bucket holds only ciphertext.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY select the project; DOCUMENT_BUCKET the bucket
 * ("documents"). A test server (REQUIRE_TEST_SCHEMA=true) without them keeps files in memory, so
 * the suites run before the test project's key is set; anywhere else they are required.
 */

export interface DocumentStore {
    put(path: string, bytes: Buffer): Promise<void>;
    get(path: string): Promise<Buffer>;
    remove(path: string): Promise<void>;
}

export class StoreUnavailableError extends Error {}

class SupabaseStore implements DocumentStore {
    constructor(private readonly url: string, private readonly key: string, private readonly bucket: string) {}

    private object(path: string): string {
        return `${this.url.replace(/\/$/, '')}/storage/v1/object/${this.bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
    }

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
    }

    private async call(path: string, init: RequestInit): Promise<Response> {
        let response: Response;
        try {
            response = await fetch(this.object(path), { ...init, signal: AbortSignal.timeout(10_000) });
        } catch (error) {
            throw new StoreUnavailableError(`Document store unreachable: ${(error as Error).message}`);
        }
        if (!response.ok) throw new StoreUnavailableError(`Document store answered ${response.status}`);
        return response;
    }

    async put(path: string, bytes: Buffer): Promise<void> {
        await this.call(path, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }), body: new Uint8Array(bytes) });
    }

    async get(path: string): Promise<Buffer> {
        const response = await this.call(path, { method: 'GET', headers: this.headers() });
        return Buffer.from(await response.arrayBuffer());
    }

    async remove(path: string): Promise<void> {
        await this.call(path, { method: 'DELETE', headers: this.headers() });
    }
}

class MemoryStore implements DocumentStore {
    private readonly files = new Map<string, Buffer>();
    async put(path: string, bytes: Buffer): Promise<void> {
        this.files.set(path, Buffer.from(bytes));
    }
    async get(path: string): Promise<Buffer> {
        const bytes = this.files.get(path);
        if (!bytes) throw new StoreUnavailableError('No such file');
        return bytes;
    }
    async remove(path: string): Promise<void> {
        this.files.delete(path);
    }
}

let store: DocumentStore | null = null;

export function documentStore(): DocumentStore {
    if (store) return store;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
        store = new SupabaseStore(url, key, process.env.DOCUMENT_BUCKET || 'documents');
    } else if (process.env.REQUIRE_TEST_SCHEMA === 'true') {
        store = new MemoryStore();
    } else {
        throw new StoreUnavailableError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    return store;
}

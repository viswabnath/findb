/**
 * Creates (or updates) the document vault's private bucket in Supabase Storage (v2 Phase 2,
 * lib/document-store.ts). Idempotent. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (.env for production; run with -r ./scripts/use-test-env.js for the test project).
 * Prints only the outcome, never the key.
 *
 *   node scripts/setup-storage.js                               # production (.env)
 *   node -r ./scripts/use-test-env.js scripts/setup-storage.js  # the test project (.env.test)
 */
require('dotenv').config({ quiet: true });

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.DOCUMENT_BUCKET || 'documents';

if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
}

// Files are stored encrypted (application/octet-stream), at most 2 MB plus the 34-byte header
const settings = { public: false, file_size_limit: 2 * 1024 * 1024 + 1024, allowed_mime_types: ['application/octet-stream'] };
const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };

async function main() {
    const host = new URL(url).host;
    const existing = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
    const response = existing.ok
        ? await fetch(`${url}/storage/v1/bucket/${bucket}`, { method: 'PUT', headers, body: JSON.stringify(settings) })
        : await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers, body: JSON.stringify({ id: bucket, name: bucket, ...settings }) });
    if (!response.ok) {
        console.error(`Storage on ${host} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
        process.exit(1);
    }
    const check = await (await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers })).json();
    if (check.public !== false) {
        console.error(`Warning: bucket ${bucket} on ${host} is not private`);
        process.exit(1);
    }
    console.log(`Bucket ${bucket} on ${host}: ${existing.ok ? 'updated' : 'created'}, private, files up to 2 MB`);
}

main().catch(error => {
    console.error(`Storage setup failed: ${error.message}`);
    process.exit(1);
});

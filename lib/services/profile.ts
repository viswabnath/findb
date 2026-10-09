import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { decryptField, encryptField } from '../field-encryption';
import { RequestError, withTransaction } from '../transaction';
import { entryDate } from './transactions';

/**
 * The user's profile and dependants (docs/privacy.md). PAN and demat or broker account IDs are
 * encrypted before they are stored (lib/field-encryption.ts, bound to the user) and only ever
 * returned masked; Aadhaar is at most its last four digits. Nothing here is needed to use FinDB.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

export interface Profile {
    dateOfBirth: string | null;
    city: string | null;
    taxResidency: 'resident' | 'nri' | 'rnor' | null;
    /** PAN shown masked: the first two and last two characters */
    panMasked: string | null;
    aadhaarLast4: string | null;
    dematAccounts: { broker: string; accountMasked: string }[];
}

export interface Dependant {
    id: number;
    relationship: 'spouse' | 'child' | 'parent' | 'other';
    name: string;
    dateOfBirth: string | null;
}

const RESIDENCIES = ['resident', 'nri', 'rnor'];
const RELATIONSHIPS = ['spouse', 'child', 'parent', 'other'];
const panContext = (userId: number) => `profiles.pan:${userId}`;
const dematContext = (userId: number) => `profiles.demat_accounts:${userId}`;

/** "ABCDE1234F" as "AB******4F": enough to recognise, not enough to use */
export function maskId(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length);
    return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
}

export const isValidPan = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function optionalDate(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const date = entryDate(value);
    if (!date) throw new RequestError(400, `${label} is not a valid date`);
    if (date.date > today()) throw new RequestError(400, `${label} cannot be in the future`);
    if (date.date < '1900-01-02') throw new RequestError(400, `${label} is too far in the past`);
    return date.date;
}

async function row(client: Client, userId: number): Promise<Record<string, unknown> | null> {
    const result = await client.query(
        `SELECT date_of_birth::text AS date_of_birth, city, tax_residency, pan_enc, aadhaar_last4, demat_accounts_enc
         FROM profiles WHERE user_id = $1`, [userId]);
    return result.rows[0] ?? null;
}

function toProfile(userId: number, data: Record<string, unknown> | null): Profile {
    const demat = data?.demat_accounts_enc
        ? JSON.parse(decryptField(String(data.demat_accounts_enc), dematContext(userId))) as { broker: string; accountId: string }[] : [];
    return {
        dateOfBirth: (data?.date_of_birth as string | null) ?? null,
        city: (data?.city as string | null) ?? null,
        taxResidency: (data?.tax_residency as Profile['taxResidency']) ?? null,
        panMasked: data?.pan_enc ? maskId(decryptField(String(data.pan_enc), panContext(userId))) : null,
        aadhaarLast4: (data?.aadhaar_last4 as string | null) ?? null,
        dematAccounts: demat.map(account => ({ broker: account.broker, accountMasked: maskId(account.accountId) })),
    };
}

export async function getProfile(pool: Pool, userId: number): Promise<Profile> {
    return toProfile(userId, await row(pool, userId));
}

/**
 * Change the profile: any field left out stays; null or empty clears it. { pan } is checked and
 * encrypted; { aadhaarLast4 } takes four digits only; { dematAccounts: [{ broker, accountId }] }
 * replaces the list (encrypted as a whole).
 */
export async function updateProfile(pool: Pool, userId: number, body: Body): Promise<Profile> {
    return withTransaction(pool, async (client) => {
        await client.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        await client.query('SELECT 1 FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
        const current = await row(client, userId);
        const has = (key: string) => body[key] !== undefined;
        const empty = (value: unknown) => value === null || value === '';

        const dateOfBirth = has('dateOfBirth') ? optionalDate(body.dateOfBirth, 'Date of birth') : current?.date_of_birth ?? null;
        let city = current?.city ?? null;
        if (has('city')) {
            if (!empty(body.city) && (typeof body.city !== 'string' || body.city.trim().length > 80)) throw new RequestError(400, 'City is too long (max 80 characters)');
            city = empty(body.city) ? null : String(body.city).trim();
        }
        let taxResidency = current?.tax_residency ?? null;
        if (has('taxResidency')) {
            if (!empty(body.taxResidency) && !RESIDENCIES.includes(String(body.taxResidency))) {
                throw new RequestError(400, 'Tax residency must be resident, NRI or RNOR');
            }
            taxResidency = empty(body.taxResidency) ? null : String(body.taxResidency);
        }
        let panEnc = current?.pan_enc ?? null;
        if (has('pan')) {
            if (empty(body.pan)) {
                panEnc = null;
            } else {
                const pan = String(body.pan).trim().toUpperCase();
                if (!isValidPan(pan)) throw new RequestError(400, 'PAN must be 5 letters, 4 digits and a letter, such as ABCDE1234F');
                panEnc = encryptField(pan, panContext(userId));
            }
        }
        let aadhaar = current?.aadhaar_last4 ?? null;
        if (has('aadhaarLast4')) {
            const value = empty(body.aadhaarLast4) ? null : String(body.aadhaarLast4).replace(/\s/g, '');
            if (value !== null && /^\d{12}$/.test(value)) {
                throw new RequestError(400, 'FinDB keeps only the last four digits of Aadhaar, never the full number');
            }
            if (value !== null && !/^\d{4}$/.test(value)) throw new RequestError(400, 'Enter the last four digits of Aadhaar');
            aadhaar = value;
        }
        let dematEnc = current?.demat_accounts_enc ?? null;
        if (has('dematAccounts')) {
            const list = body.dematAccounts;
            if (list !== null && !Array.isArray(list)) throw new RequestError(400, 'Demat accounts must be a list');
            const accounts = ((list ?? []) as unknown[]).map(item => {
                const { broker, accountId } = (item ?? {}) as { broker?: unknown; accountId?: unknown };
                if (typeof broker !== 'string' || !broker.trim() || broker.length > 60) throw new RequestError(400, 'Each demat account needs a broker name');
                if (typeof accountId !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(accountId.trim())) {
                    throw new RequestError(400, 'A demat or broker account ID is 4 to 32 letters and digits');
                }
                return { broker: broker.trim(), accountId: accountId.trim().toUpperCase() };
            });
            if (accounts.length > 20) throw new RequestError(400, 'At most 20 demat accounts');
            dematEnc = accounts.length === 0 ? null : encryptField(JSON.stringify(accounts), dematContext(userId));
        }

        await client.query(
            `UPDATE profiles SET date_of_birth = $1, city = $2, tax_residency = $3, pan_enc = $4, aadhaar_last4 = $5,
                    demat_accounts_enc = $6, updated_at = now() WHERE user_id = $7`,
            [dateOfBirth, city, taxResidency, panEnc, aadhaar, dematEnc, userId]);
        // The log says what changed, never the values of PAN, Aadhaar or account IDs
        const changed = ['dateOfBirth', 'city', 'taxResidency', 'pan', 'aadhaarLast4', 'dematAccounts'].filter(has);
        if (changed.length > 0) await logActivity(client, userId, 'updated', 'profile', userId, `Updated profile: ${changed.join(', ')}`);
        return toProfile(userId, await row(client, userId));
    });
}

// ----- Dependants -----

function readDependant(body: Body, current?: Dependant): Omit<Dependant, 'id'> {
    const relationship = String(body.relationship ?? current?.relationship ?? '');
    if (!RELATIONSHIPS.includes(relationship)) throw new RequestError(400, 'Relationship must be spouse, child, parent or other');
    const nameValue = body.name ?? current?.name;
    if (typeof nameValue !== 'string' || !nameValue.trim()) throw new RequestError(400, 'Name is required');
    if (nameValue.trim().length > 80) throw new RequestError(400, 'Name is too long (max 80 characters)');
    const dateOfBirth = body.dateOfBirth === undefined ? current?.dateOfBirth ?? null : optionalDate(body.dateOfBirth, 'Date of birth');
    return { relationship: relationship as Dependant['relationship'], name: nameValue.trim(), dateOfBirth };
}

const DEPENDANT_COLUMNS = 'id, relationship, name, date_of_birth::text AS date_of_birth';
const toDependant = (data: Record<string, unknown>): Dependant => ({
    id: Number(data.id), relationship: data.relationship as Dependant['relationship'], name: String(data.name),
    dateOfBirth: (data.date_of_birth as string | null) ?? null,
});

export async function listDependants(pool: Pool, userId: number): Promise<Dependant[]> {
    const result = await pool.query(
        `SELECT ${DEPENDANT_COLUMNS} FROM dependants WHERE user_id = $1
         ORDER BY array_position(ARRAY['spouse', 'child', 'parent', 'other'], relationship), date_of_birth NULLS LAST, id`, [userId]);
    return result.rows.map(toDependant);
}

export async function addDependant(pool: Pool, userId: number, body: Body): Promise<Dependant> {
    const input = readDependant(body);
    return withTransaction(pool, async (client) => {
        const count = await client.query('SELECT count(*)::int AS n FROM dependants WHERE user_id = $1', [userId]);
        if (count.rows[0].n >= 20) throw new RequestError(400, 'At most 20 dependants');
        const created = await client.query(
            `INSERT INTO dependants (user_id, relationship, name, date_of_birth) VALUES ($1, $2, $3, $4) RETURNING ${DEPENDANT_COLUMNS}`,
            [userId, input.relationship, input.name, input.dateOfBirth]);
        await logActivity(client, userId, 'created', 'dependant', Number(created.rows[0].id), `Added ${input.relationship}: ${input.name}`);
        return toDependant(created.rows[0]);
    });
}

export async function updateDependant(pool: Pool, userId: number, id: string, body: Body): Promise<Dependant> {
    return withTransaction(pool, async (client) => {
        const found = /^\d+$/.test(id)
            ? await client.query(`SELECT ${DEPENDANT_COLUMNS} FROM dependants WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]) : { rows: [] };
        if (!found.rows[0]) throw new RequestError(404, 'Dependant not found');
        const input = readDependant(body, toDependant(found.rows[0]));
        const updated = await client.query(
            `UPDATE dependants SET relationship = $1, name = $2, date_of_birth = $3 WHERE id = $4 AND user_id = $5 RETURNING ${DEPENDANT_COLUMNS}`,
            [input.relationship, input.name, input.dateOfBirth, id, userId]);
        await logActivity(client, userId, 'updated', 'dependant', Number(id), `Updated ${input.relationship}: ${input.name}`);
        return toDependant(updated.rows[0]);
    });
}

export async function removeDependant(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const removed = /^\d+$/.test(id)
            ? await client.query('DELETE FROM dependants WHERE id = $1 AND user_id = $2 RETURNING relationship, name', [id, userId]) : { rows: [] };
        if (!removed.rows[0]) throw new RequestError(404, 'Dependant not found');
        await logActivity(client, userId, 'deleted', 'dependant', Number(id), `Removed ${removed.rows[0].relationship}: ${removed.rows[0].name}`);
    });
}

// ----- Demat accounts, one at a time (the screen never sees the stored IDs, so it cannot resend the list) -----

async function dematList(client: Client, userId: number): Promise<{ broker: string; accountId: string }[]> {
    const data = await row(client, userId);
    return data?.demat_accounts_enc ? JSON.parse(decryptField(String(data.demat_accounts_enc), dematContext(userId))) : [];
}

/** { broker, accountId }: add one demat or broker account (locked, then saved through updateProfile) */
export async function addDematAccount(pool: Pool, userId: number, body: Body): Promise<Profile> {
    await pool.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    await pool.query('SELECT 1 FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
    const list = await dematList(pool, userId);
    return updateProfile(pool, userId, { dematAccounts: [...list, body] });
}

/** Remove the demat account at a position in the list */
export async function removeDematAccount(pool: Pool, userId: number, index: string): Promise<Profile> {
    await pool.query('SELECT 1 FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
    const list = await dematList(pool, userId);
    const position = Number(index);
    if (!/^\d+$/.test(index) || position >= list.length) throw new RequestError(404, 'Demat account not found');
    return updateProfile(pool, userId, { dematAccounts: list.filter((_, at) => at !== position) });
}

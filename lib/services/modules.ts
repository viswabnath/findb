import type { Pool } from 'pg';
import { logActivity } from '../activity-log';
import { MODULE_KEYS, modulesFromTracking, modulesProblem, suggestModule, trackingFromModules, type ModuleInfo } from '../modules';
import { RequestError, withTransaction } from '../transaction';

/**
 * Module switches (lib/modules.ts): what a user tracks. Turning one off keeps its data. The former
 * tracking choice (users.tracking_option) is written with every change, so code that reads it
 * keeps working. A user without modules yet (registered before 0017 ran, or created by a test)
 * has the ones their tracking choice means.
 */

type Body = Record<string, unknown>;

export interface UserModules { modules: string[]; declined: string[] }

export async function getModules(pool: Pool, userId: number): Promise<UserModules> {
    const result = await pool.query('SELECT modules, declined_modules, tracking_option FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    if (!row) throw new RequestError(404, 'User not found');
    return { modules: row.modules ?? modulesFromTracking(row.tracking_option), declined: row.declined_modules ?? [] };
}

/** Switch modules on and off: { modules: [...] }, in the order of lib/modules.ts */
export async function setModules(pool: Pool, userId: number, body: Body): Promise<UserModules> {
    const problem = modulesProblem(body.modules);
    if (problem) throw new RequestError(400, problem);
    const chosen = MODULE_KEYS.filter(key => (body.modules as string[]).includes(key));
    return withTransaction(pool, async (client) => {
        const before = await client.query('SELECT modules, tracking_option FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const old = before.rows[0]?.modules ?? modulesFromTracking(before.rows[0]?.tracking_option);
        await client.query('UPDATE users SET modules = $1, tracking_option = $2 WHERE id = $3', [chosen, trackingFromModules(chosen), userId]);
        await logActivity(client, userId, 'UPDATE', 'modules', userId, `Changed what FinDB tracks: ${chosen.join(', ')}`, null, { modules: old }, { modules: chosen });
        const result = await client.query('SELECT declined_modules FROM users WHERE id = $1', [userId]);
        return { modules: chosen, declined: result.rows[0].declined_modules };
    });
}

/** Answer a suggestion: { module, accept }. Accepting turns it on; declining means it is not offered again. */
export async function answerSuggestion(pool: Pool, userId: number, body: Body): Promise<UserModules> {
    const key = body.module;
    if (typeof key !== 'string' || !MODULE_KEYS.includes(key as never)) throw new RequestError(400, 'Choose from the listed modules');
    const current = await getModules(pool, userId);
    if (body.accept === true) {
        if (current.modules.includes(key)) return current;
        return setModules(pool, userId, { modules: [...current.modules, key] });
    }
    if (current.declined.includes(key)) return current;
    const declined = [...current.declined, key];
    await pool.query('UPDATE users SET declined_modules = $1 WHERE id = $2', [declined, userId]);
    return { modules: current.modules, declined };
}

/** The module an entry's title suggests, if it is off and not declined before */
export async function suggestionFor(pool: Pool, userId: number, title: unknown): Promise<ModuleInfo | null> {
    if (typeof title !== 'string' || !title.trim()) return null;
    const { modules, declined } = await getModules(pool, userId);
    return suggestModule(title, modules, declined);
}

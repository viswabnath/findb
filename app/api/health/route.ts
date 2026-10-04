import { withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';

/**
 * For an uptime monitor: confirms that the app and its database answer, with one trivial query.
 * Called every few minutes, it also keeps the free Supabase project from pausing in quiet weeks
 * (docs/costs.md). It reveals nothing beyond up or down, and is never cached.
 */
export const GET = withPublic(async () => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
        await db().query('SELECT 1');
        return Response.json({ ok: true }, { headers });
    } catch {
        return Response.json({ ok: false }, { status: 503, headers });
    }
});

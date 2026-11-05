import { timingSafeEqual } from 'node:crypto';
import { ownerPool } from '@/lib/db';
import { t } from '@/lib/i18n';
import { runReminders } from '@/lib/services/reminders';
import { RequestError } from '@/lib/transaction';

/**
 * The daily reminders (vercel.json crons, about 08:00 in India). Vercel calls it with
 * "Authorization: Bearer <CRON_SECRET>"; anything else is refused. There is no signed-in user, so
 * it runs as the owner (lib/services/reminders.ts filters by user throughout).
 */
function authorised(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const given = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request): Promise<Response> {
    if (!authorised(request)) return Response.json({ error: t('errors.authRequired') }, { status: 401 });
    try {
        return Response.json(await runReminders(ownerPool()));
    } catch (error) {
        if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
        console.error('Daily reminders failed:', error);
        return Response.json({ error: t('errors.generic') }, { status: 500 });
    }
}

import { jsonError, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { monthlySummary } from '@/lib/services/reports';
import { RequestError } from '@/lib/transaction';
import { t } from '@/lib/i18n';

export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    try {
        return Response.json(await monthlySummary(db(), userId, params.get('month'), params.get('year')));
    } catch (error) {
        if (error instanceof RequestError) throw error;
        // The summary's own message (the screen shows it); the details stay in the server log
        console.error('Monthly summary failed:', error);
        return jsonError(500, t('errors.summaryFailed'));
    }
});

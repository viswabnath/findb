import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { spendingInsights } from '@/lib/services/insights';

// ?month=1-12&year=YYYY (this month when left out): category averages, unusual spend, events, a year's trend, subscriptions
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await spendingInsights(db(), userId, params.get('month'), params.get('year')));
});

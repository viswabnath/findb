import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { frequentCategories } from '@/lib/services/categories';

// ?kind=income|expense&limit=1-12 (6): the most used categories of the last 90 days, then the defaults
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await frequentCategories(db(), userId, params.get('kind'), params.get('limit')));
});

import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { suggestCategory } from '@/lib/services/categories';

// ?kind=income|expense&description=...: the category a title suggests, from the user's past choices or keywords
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await suggestCategory(db(), userId, params.get('kind'), params.get('description')));
});

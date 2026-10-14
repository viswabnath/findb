import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { budgetFor } from '@/lib/services/budgets';

// ?categoryId=&date=YYYY-MM-DD: that category's budget in the date's month, or { budget: null }
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json({ budget: await budgetFor(db(), userId, params.get('categoryId'), params.get('date')) });
});

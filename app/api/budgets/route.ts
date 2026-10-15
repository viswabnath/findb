import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listBudgets, setBudget } from '@/lib/services/budgets';

// ?month=1-12&year=YYYY (this month when left out): budgets with what was spent, fullest first
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await listBudgets(db(), userId, params.get('month'), params.get('year')));
});

// { categoryId, amount }: set or change a spending category's monthly limit
export const PUT = withUser(async (request, userId) => Response.json(await setBudget(db(), userId, await jsonBody(request))));

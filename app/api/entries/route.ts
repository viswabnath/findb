import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createEntry, listEntries } from '@/lib/services/entries';

// ?month=1-12&year=YYYY: income, expenses and transfers dated in that month, newest first
export const GET = withUser(async (request, userId) => {
    const params = request.nextUrl.searchParams;
    return Response.json(await listEntries(db(), userId, params.get('month'), params.get('year')));
});

// { type: "income" | "expense" | "transfer", date, description, amount, accountId, toAccountId? }
export const POST = withUser(async (request, userId) => Response.json(await createEntry(db(), userId, await jsonBody(request))));

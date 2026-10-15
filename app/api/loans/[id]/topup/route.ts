import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { topUp } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { amount, accountId, date }: more money on the loan
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await topUp(db(), userId, id, await jsonBody(request)));
});

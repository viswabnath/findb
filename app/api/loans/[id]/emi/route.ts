import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { payEmi } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { amount, accountId, date, interest? }: an EMI; interest defaults to a month on what is owed
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await payEmi(db(), userId, id, await jsonBody(request)));
});

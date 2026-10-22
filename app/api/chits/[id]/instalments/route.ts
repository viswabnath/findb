import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { payInstalment } from '@/lib/services/chits';

/** The [id] segment: a chit's id */
type Context = { params: Promise<{ id: string }> };

// { month, accountId, date, dividend? }: a month's payment
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await payInstalment(db(), userId, id, await jsonBody(request)));
});

import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { settleAsGift } from '@/lib/services/people';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { date? }: close the loan; what is left becomes a gift given or received
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await settleAsGift(db(), userId, id, await jsonBody(request)));
});

import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { recordAuction } from '@/lib/services/chits';

/** The [id] segment: a chit's id */
type Context = { params: Promise<{ id: string }> };

// { month, heldOn, discount, wonByUser?, deductions?, accountId? }: a month's auction
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await recordAuction(db(), userId, id, await jsonBody(request)));
});

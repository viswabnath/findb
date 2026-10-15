import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { addSettlement } from '@/lib/services/groups';

/** The [id] segment: a group's id */
type Context = { params: Promise<{ id: string }> };

// { from, to, amount, date, accountId? }: the group, updated
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await addSettlement(db(), userId, id, await jsonBody(request)));
});

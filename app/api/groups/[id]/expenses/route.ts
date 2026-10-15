import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { addSharedExpense } from '@/lib/services/groups';

/** The [id] segment: a group's id */
type Context = { params: Promise<{ id: string }> };

// { date, description, amount, paidBy, accountId?, categoryId?, split, parts: [{ member, value? }], treat? }: the group, updated
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await addSharedExpense(db(), userId, id, await jsonBody(request)));
});

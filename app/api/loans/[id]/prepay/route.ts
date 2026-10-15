import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { prepay } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { amount, accountId, date, keep: "tenure" | "emi", charges? }: a part payment, with the interest it saves
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await prepay(db(), userId, id, await jsonBody(request)));
});

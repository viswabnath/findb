import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { changeRate } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { from, interestRate, rateUnit?, keep: "tenure" | "emi" }: a floating rate changed
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await changeRate(db(), userId, id, await jsonBody(request)));
});

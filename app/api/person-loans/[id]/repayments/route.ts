import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { recordRepayment } from '@/lib/services/people';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { amount, accountId, date, interest? }: money back on the loan; interest due is taken first unless given
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await recordRepayment(db(), userId, id, await jsonBody(request)));
});

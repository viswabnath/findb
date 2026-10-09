import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { receiveRepayment } from '@/lib/services/reimbursements';

type Context = { params: Promise<{ id: string }> };

// { amount, accountId, date, close? }: money paid back; close turns what was not repaid into spending
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await receiveRepayment(db(), userId, id, await jsonBody(request)));
});

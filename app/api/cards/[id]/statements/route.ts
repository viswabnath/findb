import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { recordStatement } from '@/lib/services/cards';

/** The [id] segment: the card's ledger account id */
type Context = { params: Promise<{ id: string }> };

// { statementDate, dueOn?, amountDue, minimumDue?, interest?, fees? }: the bank's statement
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await recordStatement(db(), userId, id, await jsonBody(request)));
});

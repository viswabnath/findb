import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { tickLines } from '@/lib/services/reconciliation';

type Context = { params: Promise<{ id: string }> };

// { lineIds, ticked }: tick lines off against the statement, or untick them
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await tickLines(db(), userId, id, await jsonBody(request)));
});

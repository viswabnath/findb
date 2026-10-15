import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { revaluePledge } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { goldRate?, value?, ltvLimit?, description? }: value the pledged asset again
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await revaluePledge(db(), userId, id, await jsonBody(request)));
});

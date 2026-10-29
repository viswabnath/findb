import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteLine, updateLine } from '@/lib/services/credit-lines';

/** The [lineId] segment: a shared limit's id */
type Context = { params: Promise<{ lineId: string }> };

// { name?, limit?, cardIds? }: change a shared limit
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { lineId } = await context.params;
    return Response.json(await updateLine(db(), userId, lineId, await jsonBody(request)));
});

// Removes a shared limit: its cards keep their own limits
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { lineId } = await context.params;
    await deleteLine(db(), userId, lineId);
    return Response.json({ success: true });
});

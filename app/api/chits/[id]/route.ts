import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteChit } from '@/lib/services/chits';

/** The [id] segment: a chit's id */
type Context = { params: Promise<{ id: string }> };

// Removes a chit entered by mistake: its entries are voided
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteChit(db(), userId, id);
    return Response.json({ success: true });
});

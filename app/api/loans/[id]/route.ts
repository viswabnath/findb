import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteLoan } from '@/lib/services/loans';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// Removes a loan entered by mistake: its entries are voided
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteLoan(db(), userId, id);
    return Response.json({ success: true });
});

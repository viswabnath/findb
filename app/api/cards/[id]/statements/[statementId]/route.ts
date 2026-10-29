import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteStatement } from '@/lib/services/cards';

/** The [id] and [statementId] segments: a card, and one of its recorded statements */
type Context = { params: Promise<{ id: string; statementId: string }> };

// Removes a statement recorded by mistake: its interest and fees entry is voided
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, statementId } = await context.params;
    return Response.json(await deleteStatement(db(), userId, id, statementId));
});

import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { undoImport } from '@/lib/services/statement-import';

/** The [id] segment: an import id, as /api/imports lists it */
type Context = { params: Promise<{ id: string }> };

// Undo an import; ?confirmReconciled=true when some of its entries are on a reconciled statement
export const DELETE = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await undoImport(db(), userId, id, { confirmReconciled: request.nextUrl.searchParams.get('confirmReconciled') === 'true' }));
});

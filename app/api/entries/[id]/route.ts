import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteEntry, updateEntry } from '@/lib/services/entries';

/** The [id] segment: an entry id, as /api/entries lists it */
type Context = { params: Promise<{ id: string }> };

// Same body as POST /api/entries; the edited entry gets a new id (the old one is kept, voided)
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateEntry(db(), userId, id, await jsonBody(request)));
});

// ?confirmReconciled=true to delete an entry that is part of a reconciled statement
export const DELETE = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    await deleteEntry(db(), userId, id, { confirmReconciled: request.nextUrl.searchParams.get('confirmReconciled') === 'true' });
    return Response.json({ success: true });
});

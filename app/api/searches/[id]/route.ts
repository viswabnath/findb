import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteSavedSearch } from '@/lib/services/search';

/** The [id] segment: a saved search's id */
type Context = { params: Promise<{ id: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteSavedSearch(db(), userId, id);
    return Response.json({ success: true });
});

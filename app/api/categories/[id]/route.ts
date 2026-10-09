import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { archiveCategory, updateCategory } from '@/lib/services/categories';

/** The [id] segment: a category id, as /api/categories lists it */
type Context = { params: Promise<{ id: string }> };

// { name?, essential? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateCategory(db(), userId, id, await jsonBody(request)));
});

// Remove a category; entries that use it keep it in their history
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await archiveCategory(db(), userId, id);
    return Response.json({ success: true });
});

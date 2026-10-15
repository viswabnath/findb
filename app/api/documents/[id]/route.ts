import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteDocument, updateDocument } from '@/lib/services/documents';

/** The [id] segment: a document's id */
type Context = { params: Promise<{ id: string }> };

// { kind?, title?, date?, expiresOn?, notes?, links? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateDocument(db(), userId, id, await jsonBody(request)));
});

// Deletes the document and its file
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteDocument(db(), userId, id);
    return Response.json({ success: true });
});

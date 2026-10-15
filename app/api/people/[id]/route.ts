import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { archivePerson, updatePerson } from '@/lib/services/people';

/** The [id] segment: a person's id */
type Context = { params: Promise<{ id: string }> };

// { name?, notes? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updatePerson(db(), userId, id, await jsonBody(request)));
});

// Removes a person once nothing is owed either way
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await archivePerson(db(), userId, id);
    return Response.json({ success: true });
});

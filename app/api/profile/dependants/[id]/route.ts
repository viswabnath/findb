import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { removeDependant, updateDependant } from '@/lib/services/profile';

type Context = { params: Promise<{ id: string }> };

export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateDependant(db(), userId, id, await jsonBody(request)));
});

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await removeDependant(db(), userId, id);
    return Response.json({ success: true });
});

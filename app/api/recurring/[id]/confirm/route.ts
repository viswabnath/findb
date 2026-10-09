import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { confirmDue } from '@/lib/services/recurring';

type Context = { params: Promise<{ id: string }> };

// { date?, amount? }: record the next due occurrence now, with its amount or another one
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await confirmDue(db(), userId, id, await jsonBody(request)));
});

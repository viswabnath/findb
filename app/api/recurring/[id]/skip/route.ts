import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { skipDue } from '@/lib/services/recurring';

type Context = { params: Promise<{ id: string }> };

// { date? }: skip the next due occurrence without recording it
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await skipDue(db(), userId, id, await jsonBody(request)));
});

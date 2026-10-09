import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { archiveEvent, eventDetail, updateEvent } from '@/lib/services/events';

/** The [id] segment: an event id, as /api/events lists it */
type Context = { params: Promise<{ id: string }> };

// The event with spending by category, receipts, how it was paid for, and its timeline
export const GET = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await eventDetail(db(), userId, id));
});

// Any of the fields of POST /api/events
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateEvent(db(), userId, id, await jsonBody(request)));
});

// Archive an event; its entries keep it
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await archiveEvent(db(), userId, id);
    return Response.json({ success: true });
});

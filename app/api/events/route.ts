import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createEvent, listEvents } from '@/lib/services/events';

// Every event and project, with what was spent, received and the net cost
export const GET = withUser(async (_request, userId) => Response.json(await listEvents(db(), userId)));

// { name, startsOn?, endsOn?, budget?, oneOff?, notes? }
export const POST = withUser(async (request, userId) => Response.json(await createEvent(db(), userId, await jsonBody(request))));

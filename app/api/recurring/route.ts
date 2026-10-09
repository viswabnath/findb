import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createRepeating, listRepeating } from '@/lib/services/recurring';

// Every repeating entry, the next one due first
export const GET = withUser(async (_request, userId) => Response.json(await listRepeating(db(), userId)));

// See docs/API.md: type, description, amount, accounts, category, tags, event, the schedule, mode, reminder
export const POST = withUser(async (request, userId) => Response.json(await createRepeating(db(), userId, await jsonBody(request))));

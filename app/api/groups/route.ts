import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createGroup, listGroups } from '@/lib/services/groups';

// The user's groups with members, balances, the settle-up plan, costs and settlements
export const GET = withUser(async (_request, userId) => Response.json(await listGroups(db(), userId)));

// { name, memberIds: [person ids], eventId? }
export const POST = withUser(async (request, userId) => Response.json(await createGroup(db(), userId, await jsonBody(request))));

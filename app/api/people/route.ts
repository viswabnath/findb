import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createPerson, listPeople } from '@/lib/services/people';

// The user's people with their balances and loans, and the totals owed both ways
export const GET = withUser(async (_request, userId) => Response.json(await listPeople(db(), userId)));

// { name, notes? }
export const POST = withUser(async (request, userId) => Response.json(await createPerson(db(), userId, await jsonBody(request))));

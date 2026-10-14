import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createEntries } from '@/lib/services/entries';

// { entries: [{ type, date, description, amount, accountId, toAccountId?, categoryId?, tags? }] }: all saved, or none
export const POST = withUser(async (request, userId) => Response.json(await createEntries(db(), userId, await jsonBody(request))));

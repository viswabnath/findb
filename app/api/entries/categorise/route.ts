import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { categoriseEntries } from '@/lib/services/entries';

// { entryIds: [...], categoryId }: put several entries in one category at once
export const POST = withUser(async (request, userId) => Response.json(await categoriseEntries(db(), userId, await jsonBody(request))));

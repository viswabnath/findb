import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listSavedSearches, saveSearch } from '@/lib/services/search';

// The user's saved searches, by name
export const GET = withUser(async (_request, userId) => Response.json(await listSavedSearches(db(), userId)));

// { name, filters }: save a search; the same name replaces it
export const POST = withUser(async (request, userId) => Response.json(await saveSearch(db(), userId, await jsonBody(request))));

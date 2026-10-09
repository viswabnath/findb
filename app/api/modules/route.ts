import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { getModules, setModules } from '@/lib/services/modules';

// { modules: [...], declined: [...] }: what the user tracks (lib/modules.ts)
export const GET = withUser(async (_request, userId) => Response.json(await getModules(db(), userId)));

// { modules: [...] }: switch modules on and off; data is kept
export const PUT = withUser(async (request, userId) => Response.json(await setModules(db(), userId, await jsonBody(request))));

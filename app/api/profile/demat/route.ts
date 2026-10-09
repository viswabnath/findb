import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { addDematAccount } from '@/lib/services/profile';

// { broker, accountId }: add one demat or broker account (stored encrypted, shown masked)
export const POST = withUser(async (request, userId) => Response.json(await addDematAccount(db(), userId, await jsonBody(request))));

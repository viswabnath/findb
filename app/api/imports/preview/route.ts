import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { previewImport } from '@/lib/services/statement-import';

// { accountId, rows: [{ line, date, description, narration, amount }] }: duplicates, transfers and categories for the review; saves nothing
export const POST = withUser(async (request, userId) => Response.json(await previewImport(db(), userId, await jsonBody(request))));

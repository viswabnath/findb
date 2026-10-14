import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { commitImport, listImports } from '@/lib/services/statement-import';

// The user's statement imports, newest first
export const GET = withUser(async (_request, userId) => Response.json(await listImports(db(), userId)));

// { accountId, fileKind, rowsInFile, closingBalance?, layout?, rows: [{ line, date, description, amount, action }] }: save the reviewed rows as one import
export const POST = withUser(async (request, userId) => Response.json(await commitImport(db(), userId, await jsonBody(request))));

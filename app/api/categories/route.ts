import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createCategory, listCategories } from '@/lib/services/categories';

// The user's income and spending categories (the defaults are made the first time)
export const GET = withUser(async (_request, userId) => Response.json(await listCategories(db(), userId)));

// { kind: "income" | "expense", name, essential? }
export const POST = withUser(async (request, userId) => Response.json(await createCategory(db(), userId, await jsonBody(request))));

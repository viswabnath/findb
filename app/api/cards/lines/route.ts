import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createLine, listLines } from '@/lib/services/credit-lines';

// Limits shared by several cards, with what their cards owe and what is left
export const GET = withUser(async (_request, userId) => Response.json(await listLines(db(), userId)));

// { name, limit, cardIds }: a limit shared by two or more cards
export const POST = withUser(async (request, userId) => Response.json(await createLine(db(), userId, await jsonBody(request))));

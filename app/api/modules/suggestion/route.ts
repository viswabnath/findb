import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { answerSuggestion, suggestionFor } from '@/lib/services/modules';

// ?title=...: { suggestion: module | null }, the switched-off module an entry's title suggests
export const GET = withUser(async (request, userId) =>
    Response.json({ suggestion: await suggestionFor(db(), userId, request.nextUrl.searchParams.get('title')) }));

// { module, accept }: turn it on, or do not offer it again
export const POST = withUser(async (request, userId) => Response.json(await answerSuggestion(db(), userId, await jsonBody(request))));

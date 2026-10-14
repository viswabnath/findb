import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { search } from '@/lib/services/search';

// ?q=&from=&to=&min=&max=&type=&accountId=&categoryId=&tag=&eventId=&offset=: matching entries (50 a page), their totals, and matching names
export const GET = withUser(async (request, userId) => Response.json(await search(db(), userId, Object.fromEntries(request.nextUrl.searchParams))));

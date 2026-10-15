import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createChit, listChits } from '@/lib/services/chits';

// The user's chits: what to pay next, payments, auctions, and the true return or cost
export const GET = withUser(async (_request, userId) => Response.json(await listChits(db(), userId)));

// { name, organiserKind, organiser?, registration?, value, members, months?, contribution?, commissionPercent?, startedOn, auctionDay?, notes? }
export const POST = withUser(async (request, userId) => Response.json(await createChit(db(), userId, await jsonBody(request))));

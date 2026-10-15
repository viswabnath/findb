import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createLoan, listLoans } from '@/lib/services/loans';

// The user's loans with what is owed, the schedule, payments, per-year figures and the foreclosure amount
export const GET = withUser(async (_request, userId) => Response.json(await listLoans(db(), userId)));

// A new loan (accountId: where the money came in) or one already running (outstanding: owed today); see docs/API.md
export const POST = withUser(async (request, userId) => Response.json(await createLoan(db(), userId, await jsonBody(request))));

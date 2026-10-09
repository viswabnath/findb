import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createReimbursement, listReimbursements } from '@/lib/services/reimbursements';

// Expenses someone will pay back: the open ones first
export const GET = withUser(async (_request, userId) => Response.json(await listReimbursements(db(), userId)));

// { description, amount, accountId, date, fromWhom?, categoryId?, eventId? }
export const POST = withUser(async (request, userId) => Response.json(await createReimbursement(db(), userId, await jsonBody(request))));

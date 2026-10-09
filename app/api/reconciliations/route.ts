import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listReconciliations, startReconciliation } from '@/lib/services/reconciliation';

// ?accountId=: an account's reconciliations (or all), the latest first
export const GET = withUser(async (request, userId) =>
    Response.json(await listReconciliations(db(), userId, request.nextUrl.searchParams.get('accountId'))));

// { accountId, statementDate, statementBalance }: start (or restart) checking an account against a statement
export const POST = withUser(async (request, userId) => Response.json(await startReconciliation(db(), userId, await jsonBody(request))));

import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { debtReview } from '@/lib/services/debts';

// Every debt ranked by its true yearly cost, the EMI-to-income ratio, and the warnings
export const GET = withUser(async (_request, userId) => Response.json(await debtReview(db(), userId)));

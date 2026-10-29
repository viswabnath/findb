import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listRewards } from '@/lib/services/rewards';

// Each card's reward points, cashback per year, and what it gave back for what was spent
export const GET = withUser(async (_request, userId) => Response.json(await listRewards(db(), userId)));

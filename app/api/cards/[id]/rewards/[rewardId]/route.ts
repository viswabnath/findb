import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteReward } from '@/lib/services/rewards';

/** The [id] and [rewardId] segments: a card, and one of its reward records */
type Context = { params: Promise<{ id: string; rewardId: string }> };

// Removes a reward recorded by mistake: its income entry is voided
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, rewardId } = await context.params;
    return Response.json(await deleteReward(db(), userId, id, rewardId));
});

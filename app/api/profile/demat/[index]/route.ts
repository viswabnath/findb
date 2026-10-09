import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { removeDematAccount } from '@/lib/services/profile';

type Context = { params: Promise<{ index: string }> };

// Remove the demat account at a position in the profile's list
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { index } = await context.params;
    return Response.json(await removeDematAccount(db(), userId, index));
});

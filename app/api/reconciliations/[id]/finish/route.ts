import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { finishReconciliation } from '@/lib/services/reconciliation';

type Context = { params: Promise<{ id: string }> };

// { adjust? }: finish at no difference, or record the difference as an adjustment
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await finishReconciliation(db(), userId, id, await jsonBody(request)));
});

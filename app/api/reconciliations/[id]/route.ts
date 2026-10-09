import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { cancelReconciliation, getReconciliation } from '@/lib/services/reconciliation';

type Context = { params: Promise<{ id: string }> };

// The reconciliation with its lines and the difference
export const GET = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await getReconciliation(db(), userId, id));
});

// Give up an open reconciliation; its ticks are removed
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await cancelReconciliation(db(), userId, id);
    return Response.json({ success: true });
});

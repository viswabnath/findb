import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteReimbursement } from '@/lib/services/reimbursements';

type Context = { params: Promise<{ id: string }> };

// Only while nothing has been repaid: the payment is undone
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deleteReimbursement(db(), userId, id);
    return Response.json({ success: true });
});

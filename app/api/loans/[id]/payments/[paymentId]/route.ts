import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deleteLoanPayment } from '@/lib/services/loans';

/** The [id] and [paymentId] segments: a loan, and one of its payments */
type Context = { params: Promise<{ id: string; paymentId: string }> };

export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id, paymentId } = await context.params;
    return Response.json(await deleteLoanPayment(db(), userId, id, paymentId));
});

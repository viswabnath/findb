import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { deletePersonLoan, updatePersonLoan } from '@/lib/services/people';

/** The [id] segment: a loan's id */
type Context = { params: Promise<{ id: string }> };

// { dueOn?, interestRate?, rateUnit?, notes? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updatePersonLoan(db(), userId, id, await jsonBody(request)));
});

// Removes a loan entered by mistake: its entries are voided
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await deletePersonLoan(db(), userId, id);
    return Response.json({ success: true });
});

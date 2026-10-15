import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createPersonLoan } from '@/lib/services/people';

/** The [id] segment: a person's id */
type Context = { params: Promise<{ id: string }> };

// { direction: "lent" | "borrowed", amount, accountId, date, dueOn?, interestRate?, rateUnit?: "year" | "per100month", notes? }
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await createPersonLoan(db(), userId, id, await jsonBody(request)));
});

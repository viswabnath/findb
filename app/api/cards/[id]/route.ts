import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { setCardTerms } from '@/lib/services/cards';

/** The [id] segment: the card's ledger account id */
type Context = { params: Promise<{ id: string }> };

// { billingDay?, dueDay?, interestRate?, rateUnit? }: the card's statement days and interest rate
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await setCardTerms(db(), userId, id, await jsonBody(request)));
});

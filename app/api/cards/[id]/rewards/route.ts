import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { recordReward, setPointValue } from '@/lib/services/rewards';

/** The [id] segment: the card's ledger account id */
type Context = { params: Promise<{ id: string }> };

// { kind: earned | redeemed | expired | cashback, date, points?, amount?, expiresOn?, intoAccountId?, note? }
export const POST = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await recordReward(db(), userId, id, await jsonBody(request)));
});

// { pointValue }: ₹ per reward point (only shown)
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await setPointValue(db(), userId, id, await jsonBody(request)));
});

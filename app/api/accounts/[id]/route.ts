import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { archiveAccount, updateAccount } from '@/lib/services/entries';

/** The [id] segment: a ledger account id, as /api/accounts lists it */
type Context = { params: Promise<{ id: string }> };

// { name?, institution?, accountType?, interestRate?, notes? }
export const PUT = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    return Response.json(await updateAccount(db(), userId, id, await jsonBody(request)));
});

// Archive an empty wallet or meal card
export const DELETE = withUser<Context>(async (_request, userId, context) => {
    const { id } = await context.params;
    await archiveAccount(db(), userId, id);
    return Response.json({ success: true });
});

import { userAgent, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { signOutSession } from '@/lib/services/security';

/** The [id] segment: a session's id as the session list shows it */
type Context = { params: Promise<{ id: string }> };

export const DELETE = withUser<Context>(async (request, userId, context) => {
    const { id } = await context.params;
    await signOutSession(db(), userId, id, userAgent(request));
    return Response.json({ success: true });
});

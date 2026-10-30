import { isHttps, jsonBody, userAgent, withUser } from '@/lib/api-route';
import { ownerPool } from '@/lib/db';
import { deleteAccount } from '@/lib/services/account';
import { clearSessionCookie, clearSignedInHintCookie } from '@/lib/session';

// { password, code, confirm: "DELETE" }: deletes the account and everything in it, then signs out.
// Runs as the owner: the user row and the stored files are beyond the user's own database role.
export const POST = withUser(async (request, userId) => {
    await deleteAccount(ownerPool(), userId, await jsonBody(request), userAgent(request));
    const headers = new Headers({ 'Set-Cookie': clearSessionCookie(isHttps(request)) });
    headers.append('Set-Cookie', clearSignedInHintCookie(isHttps(request)));
    return Response.json({ success: true }, { headers });
});

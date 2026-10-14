import { jsonBody, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { resetPassword } from '@/lib/services/auth';
import { t } from '@/lib/i18n';

export const POST = withPublic(async (request) => {
    await resetPassword(db(), await jsonBody(request));
    return Response.json({ success: true, message: 'Password reset successfully' });
}, { authLimited: true, errorMessage: t('errors.serverError') });

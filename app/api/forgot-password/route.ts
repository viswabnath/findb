import { jsonBody, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { forgotPassword } from '@/lib/services/auth';
import { t } from '@/lib/i18n';

export const POST = withPublic(async (request) => Response.json(await forgotPassword(db(), await jsonBody(request))),
    { authLimited: true, errorMessage: t('errors.serverError') });

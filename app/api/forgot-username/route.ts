import { jsonBody, withPublic } from '@/lib/api-route';
import { db } from '@/lib/db';
import { forgotUsername } from '@/lib/services/auth';
import { t } from '@/lib/i18n';

export const POST = withPublic(async (request) => Response.json(await forgotUsername(db(), await jsonBody(request))),
    { authLimited: true, errorMessage: t('errors.serverError') });

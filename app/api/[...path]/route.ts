import { jsonError } from '@/lib/api-route';
import { t } from '@/lib/i18n';

/** Any API path without its own route: a JSON 404, not the HTML not-found page */
const notFound = async () => jsonError(404, t('errors.notFound'));

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

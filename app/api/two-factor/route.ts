import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { twoFactorStatus } from '@/lib/services/security';

export const GET = withUser(async (_request, userId) => Response.json(await twoFactorStatus(db(), userId)));

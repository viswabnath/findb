import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { loginHistory } from '@/lib/services/security';

// The last 30 sign-in events: logins, wrong passwords and codes, and security changes
export const GET = withUser(async (_request, userId) => Response.json(await loginHistory(db(), userId)));

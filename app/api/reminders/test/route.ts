import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { sendTest } from '@/lib/services/reminders';

// A test notification to the user's devices
export const POST = withUser(async (_request, userId) => Response.json(await sendTest(db(), userId)));

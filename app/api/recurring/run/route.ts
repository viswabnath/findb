import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { runDue } from '@/lib/services/recurring';

// Record the automatic repeating entries that have fallen due, and return what waits for the user
// and what is due soon. The app calls it when it opens.
export const POST = withUser(async (_request, userId) => Response.json(await runDue(db(), userId)));

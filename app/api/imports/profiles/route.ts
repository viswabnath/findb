import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listProfiles } from '@/lib/services/statement-import';

// The column choices remembered for each statement layout
export const GET = withUser(async (_request, userId) => Response.json(await listProfiles(db(), userId)));

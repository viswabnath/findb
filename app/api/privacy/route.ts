import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { myData } from '@/lib/services/privacy';

// What FinDB holds about the user (lib/data-inventory.ts), and their consent to the privacy notice
export const GET = withUser(async (_request, userId) => Response.json(await myData(db(), userId)));

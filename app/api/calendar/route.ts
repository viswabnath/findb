import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { dueCalendar } from '@/lib/services/calendar';

// Everything due this month and next: card bills, EMIs, chits, repeating entries, money with people
export const GET = withUser(async (_request, userId) => Response.json(await dueCalendar(db(), userId)));

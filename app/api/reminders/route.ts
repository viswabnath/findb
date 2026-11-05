import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listDevices, reminderSettings } from '@/lib/services/reminders';

// ?endpoint= (this device's, to mark it): whether reminders by notification are available, the key
// to subscribe with, and the devices that have them on
export const GET = withUser(async (request, userId) => Response.json({
    ...reminderSettings(), devices: await listDevices(db(), userId, request.nextUrl.searchParams.get('endpoint')),
}));

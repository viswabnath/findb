import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { getProfile, updateProfile } from '@/lib/services/profile';

// The profile, with PAN and account IDs masked
export const GET = withUser(async (_request, userId) => Response.json(await getProfile(db(), userId)));

// { dateOfBirth?, city?, taxResidency?, pan?, aadhaarLast4?, dematAccounts? }
export const PUT = withUser(async (request, userId) => Response.json(await updateProfile(db(), userId, await jsonBody(request))));

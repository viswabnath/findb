import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { addDependant, listDependants } from '@/lib/services/profile';

export const GET = withUser(async (_request, userId) => Response.json(await listDependants(db(), userId)));

// { relationship: "spouse" | "child" | "parent" | "other", name, dateOfBirth? }
export const POST = withUser(async (request, userId) => Response.json(await addDependant(db(), userId, await jsonBody(request))));

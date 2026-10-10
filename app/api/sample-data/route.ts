import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { clearSampleData, loadSampleData } from '@/lib/services/sample-data';

// Fill a fresh account with a sample family's money: { entries }
export const POST = withUser(async (_request, userId) => Response.json(await loadSampleData(db(), userId)));

// Remove every sample row: { cleared }
export const DELETE = withUser(async (_request, userId) => Response.json(await clearSampleData(db(), userId)));

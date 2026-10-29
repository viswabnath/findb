import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { listCards } from '@/lib/services/cards';

// The user's credit cards: what is owed, the latest statement, what is due and by when
export const GET = withUser(async (_request, userId) => Response.json(await listCards(db(), userId)));

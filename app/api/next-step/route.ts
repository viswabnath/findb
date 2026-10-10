import { withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { nextStep } from '@/lib/services/next-step';

// { kind, text, href?, label }: the one clear next step for the Accounts screen
export const GET = withUser(async (_request, userId) => Response.json(await nextStep(db(), userId)));

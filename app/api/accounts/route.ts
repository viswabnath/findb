import { jsonBody, withUser } from '@/lib/api-route';
import { db } from '@/lib/db';
import { createAccount, listAccounts } from '@/lib/services/entries';

// Every money account with its balance from the ledger: banks, cash, cards, wallets, meal cards
export const GET = withUser(async (_request, userId) => Response.json(await listAccounts(db(), userId)));

// { type: "wallet" | "meal_card", name, institution?, notes?, openingBalance? }
export const POST = withUser(async (request, userId) => Response.json(await createAccount(db(), userId, await jsonBody(request))));

import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, systemAccount, toPaise, voidEntry, type EntryLine } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { groupBalances, simplifyDebts, splitAmount, type SplitMethod, type SplitPart } from '../../src/core/split';
import { lockedCategory } from './categories';
import { checkCanSpend, lockedMoneyAccount } from './entries';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Shared expenses and groups (v2 Phase 3, src/core/split.ts): trips and flatmates. A group lists
 * people from the user's list; the user ("you") is always in it. Only the user's part reaches their
 * books (migration 0026): their share is spending; what friends owe them, or they owe a friend, sits
 * on that friend's person account (lib/services/people.ts), so People shows it too. Costs between
 * friends only change the group's balances. Settling up moves real money and is never spending.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;
const YOU = 'you';
const SPLITS: SplitMethod[] = ['equal', 'exact', 'percent', 'shares'];

const key = (personId: number | null) => (personId === null ? YOU : `p${personId}`);
const personOf = (member: string): number | null => (member === YOU ? null : Number(member.slice(1)));

export interface GroupMember { key: string; personId: number | null; name: string; balance: string }
export interface GroupExpense {
    id: number; date: string; description: string; amount: string; paidBy: string; paidByName: string; splitMethod: SplitMethod;
    category: { id: number; name: string } | null; yourShare: string; shares: { member: string; name: string; share: string; entered: number | null }[];
}
export interface GroupSettlement { id: number; date: string; from: string; fromName: string; to: string; toName: string; amount: string }
export interface Group {
    id: number;
    name: string;
    event: { id: number; name: string } | null;
    members: GroupMember[];
    /** Positive: the group owes the user; negative: the user owes */
    yourBalance: string;
    /** The fewest payments that settle everyone */
    plan: { from: string; fromName: string; to: string; toName: string; amount: string }[];
    /** What the user spent (their shares) and what the whole group spent, and both by category */
    yourCost: string;
    groupCost: string;
    byCategory: { name: string; yours: string; group: string }[];
    expenses: GroupExpense[];
    settlements: GroupSettlement[];
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function readDate(value: unknown): string {
    if (!value) throw new RequestError(400, t('errors.dateRequired'));
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.invalidDateFormat'));
    if (date.date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field: t('errors.people.dateField') }));
    return date.date;
}

function amountPaise(value: unknown): number {
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise <= 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

// ----- Reading -----

async function loadGroups(client: Client, userId: number, onlyId?: number): Promise<Group[]> {
    const groups = await client.query(
        `SELECT g.id, g.name, g.event_id, ev.name AS event_name FROM groups g LEFT JOIN events ev ON ev.user_id = g.user_id AND ev.id = g.event_id
         WHERE g.user_id = $1 AND g.archived_at IS NULL AND ($2::bigint IS NULL OR g.id = $2) ORDER BY g.created_at DESC, g.id DESC`, [userId, onlyId ?? null]);
    if (groups.rows.length === 0) return [];
    const ids = groups.rows.map(row => Number(row.id));
    const members = await client.query(
        `SELECT gm.group_id, p.id, p.name FROM group_members gm JOIN people p ON p.user_id = gm.user_id AND p.id = gm.person_id
         WHERE gm.user_id = $1 AND gm.group_id = ANY($2::bigint[]) ORDER BY lower(p.name)`, [userId, ids]);
    const expenses = await client.query(
        `SELECT x.id, x.group_id, x.expense_date::text AS date, x.description, x.amount_paise, x.paid_by_person_id, x.split_method,
                x.category_id, c.name AS category_name,
                coalesce((SELECT json_agg(json_build_object('person', s.person_id, 'share', s.share_paise, 'entered', s.entered) ORDER BY s.id)
                          FROM shared_expense_shares s WHERE s.user_id = x.user_id AND s.expense_id = x.id), '[]'::json) AS shares
         FROM shared_expenses x LEFT JOIN ledger_accounts c ON c.user_id = x.user_id AND c.id = x.category_id
         WHERE x.user_id = $1 AND x.group_id = ANY($2::bigint[]) AND x.deleted_at IS NULL ORDER BY x.expense_date DESC, x.id DESC`, [userId, ids]);
    const settlements = await client.query(
        `SELECT id, group_id, settled_on::text AS date, from_person_id, to_person_id, amount_paise FROM settlements
         WHERE user_id = $1 AND group_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY settled_on DESC, id DESC`, [userId, ids]);
    // Names of everyone who appears, members or not (someone removed later keeps their history)
    const people = await client.query('SELECT id, name FROM people WHERE user_id = $1', [userId]);
    const names = new Map<string, string>([[YOU, t('groups.you')], ...people.rows.map(row => [`p${row.id}`, row.name as string] as [string, string])]);
    const nameOf = (member: string) => names.get(member) ?? member;

    return groups.rows.map(row => {
        const id = Number(row.id);
        const mine = expenses.rows.filter(item => Number(item.group_id) === id);
        const paid = settlements.rows.filter(item => Number(item.group_id) === id);
        const costs = mine.map(item => ({
            paidBy: key(item.paid_by_person_id === null ? null : Number(item.paid_by_person_id)),
            total: Number(item.amount_paise),
            shares: new Map<string, number>((item.shares as { person: number | null; share: number }[]).map(share => [key(share.person === null ? null : Number(share.person)), Number(share.share)])),
        }));
        const moves = paid.map(item => ({
            from: key(item.from_person_id === null ? null : Number(item.from_person_id)), to: key(item.to_person_id === null ? null : Number(item.to_person_id)), paise: Number(item.amount_paise),
        }));
        const net = groupBalances(costs, moves);
        const memberKeys = [YOU, ...members.rows.filter(item => Number(item.group_id) === id).map(item => `p${item.id}`)];
        for (const member of memberKeys) if (!net.has(member)) net.set(member, 0);
        const byCategory = new Map<string, { yours: number; group: number }>();
        let yourCost = 0;
        let groupCost = 0;
        mine.forEach((item, index) => {
            const yours = costs[index]!.shares.get(YOU) ?? 0;
            const name = item.category_name ?? t('groups.uncategorised');
            const entry = byCategory.get(name) ?? { yours: 0, group: 0 };
            entry.yours += yours;
            entry.group += Number(item.amount_paise);
            byCategory.set(name, entry);
            yourCost += yours;
            groupCost += Number(item.amount_paise);
        });
        return {
            id, name: row.name, event: row.event_id === null ? null : { id: Number(row.event_id), name: row.event_name },
            members: [...net].filter(([member]) => memberKeys.includes(member) || net.get(member) !== 0)
                .map(([member, paise]) => ({ key: member, personId: personOf(member), name: nameOf(member), balance: fromPaise(paise) })),
            yourBalance: fromPaise(net.get(YOU) ?? 0),
            plan: simplifyDebts(net).map(move => ({ from: move.from, fromName: nameOf(move.from), to: move.to, toName: nameOf(move.to), amount: fromPaise(move.paise) })),
            yourCost: fromPaise(yourCost), groupCost: fromPaise(groupCost),
            byCategory: [...byCategory].sort((a, b) => b[1].group - a[1].group).map(([name, value]) => ({ name, yours: fromPaise(value.yours), group: fromPaise(value.group) })),
            expenses: mine.map((item, index) => ({
                id: Number(item.id), date: item.date, description: item.description, amount: fromPaise(item.amount_paise),
                paidBy: costs[index]!.paidBy, paidByName: nameOf(costs[index]!.paidBy), splitMethod: item.split_method,
                category: item.category_id === null ? null : { id: Number(item.category_id), name: item.category_name },
                yourShare: fromPaise(costs[index]!.shares.get(YOU) ?? 0),
                shares: (item.shares as { person: number | null; share: number; entered: number | null }[]).map(share => ({
                    member: key(share.person === null ? null : Number(share.person)), name: nameOf(key(share.person === null ? null : Number(share.person))),
                    share: fromPaise(share.share), entered: share.entered,
                })),
            })),
            settlements: paid.map((item, index) => ({
                id: Number(item.id), date: item.date, from: moves[index]!.from, fromName: nameOf(moves[index]!.from), to: moves[index]!.to, toName: nameOf(moves[index]!.to),
                amount: fromPaise(item.amount_paise),
            })),
        };
    });
}

export async function listGroups(pool: Pool, userId: number): Promise<Group[]> {
    return loadGroups(pool, userId);
}

async function lockedGroup(client: Client, userId: number, id: unknown): Promise<Group> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.groups.notFound'));
    const lock = await client.query('SELECT id FROM groups WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE', [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.groups.notFound'));
    return (await loadGroups(client, userId, Number(id)))[0]!;
}

// ----- Groups -----

async function readMembers(client: Client, userId: number, value: unknown): Promise<number[]> {
    if (!Array.isArray(value) || value.some(item => !/^\d+$/.test(String(item)))) throw new RequestError(400, t('errors.groups.badMembers'));
    const ids = [...new Set(value.map(Number))];
    if (ids.length === 0) throw new RequestError(400, t('errors.groups.needMembers'));
    if (ids.length > 30) throw new RequestError(400, t('errors.groups.tooManyMembers'));
    const found = await client.query('SELECT id FROM people WHERE user_id = $1 AND archived_at IS NULL AND id = ANY($2::bigint[])', [userId, ids]);
    if (found.rows.length !== ids.length) throw new RequestError(400, t('errors.groups.badMembers'));
    return ids;
}

async function readEvent(client: Client, userId: number, value: unknown): Promise<number | null> {
    if (value === undefined || value === null || value === '') return null;
    const found = await client.query('SELECT id FROM events WHERE user_id = $1 AND id = $2 AND archived_at IS NULL', [userId, /^\d+$/.test(String(value)) ? value : 0]);
    if (found.rows.length === 0) throw new RequestError(400, t('errors.fieldNotFound', { field: t('errors.groups.eventField') }));
    return Number(found.rows[0].id);
}

function groupName(value: unknown): string {
    const name = text(value);
    if (!name) throw new RequestError(400, t('errors.groups.nameRequired'));
    if (name.length > 80) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 80 }));
    return name;
}

/** { name, memberIds: [person ids], eventId? } */
export async function createGroup(pool: Pool, userId: number, body: Body): Promise<Group> {
    const name = groupName(body.name);
    return withTransaction(pool, async (client) => {
        const clash = await client.query('SELECT 1 FROM groups WHERE user_id = $1 AND archived_at IS NULL AND lower(name) = lower($2)', [userId, name]);
        if (clash.rows.length > 0) throw new RequestError(400, t('errors.groups.exists', { name }));
        const members = await readMembers(client, userId, body.memberIds);
        const eventId = await readEvent(client, userId, body.eventId);
        const created = await client.query('INSERT INTO groups (user_id, name, event_id) VALUES ($1, $2, $3) RETURNING id', [userId, name, eventId]);
        const id = Number(created.rows[0].id);
        await client.query('INSERT INTO group_members (user_id, group_id, person_id) SELECT $1, $2, unnest($3::bigint[])', [userId, id, members]);
        await logActivity(client, userId, 'created', 'group', id, `Added group: ${name}`, null, null, { name, members: members.length });
        return (await loadGroups(client, userId, id))[0]!;
    });
}

/** { name?, memberIds?, eventId? }: a member with costs or a balance in the group stays */
export async function updateGroup(pool: Pool, userId: number, id: string, body: Body): Promise<Group> {
    return withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, id);
        const name = body.name === undefined ? group.name : groupName(body.name);
        const eventId = body.eventId === undefined ? group.event?.id ?? null : await readEvent(client, userId, body.eventId);
        await client.query('UPDATE groups SET name = $1, event_id = $2 WHERE id = $3 AND user_id = $4', [name, eventId, group.id, userId]);
        if (body.memberIds !== undefined) {
            const members = await readMembers(client, userId, body.memberIds);
            const used = new Set(group.expenses.flatMap(expense => [expense.paidBy, ...expense.shares.map(share => share.member)])
                .concat(group.settlements.flatMap(item => [item.from, item.to])));
            const leaving = group.members.filter(member => member.personId !== null && !members.includes(member.personId));
            const stuck = leaving.find(member => used.has(member.key));
            if (stuck) throw new RequestError(400, t('errors.groups.memberInUse', { name: stuck.name }));
            await client.query('DELETE FROM group_members WHERE user_id = $1 AND group_id = $2', [userId, group.id]);
            await client.query('INSERT INTO group_members (user_id, group_id, person_id) SELECT $1, $2, unnest($3::bigint[])', [userId, group.id, members]);
        }
        await logActivity(client, userId, 'updated', 'group', group.id, `Updated group: ${name}`, null, { name: group.name }, { name });
        return (await loadGroups(client, userId, group.id))[0]!;
    });
}

/** Remove a group once everyone is settled; its expenses stay in the user's history */
export async function archiveGroup(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, id);
        if (group.members.some(member => toPaise(member.balance) !== 0)) throw new RequestError(400, t('errors.groups.notSettled'));
        await client.query('UPDATE groups SET archived_at = now() WHERE id = $1 AND user_id = $2', [group.id, userId]);
        await logActivity(client, userId, 'deleted', 'group', group.id, `Removed group: ${group.name}`, null, { name: group.name }, null);
    });
}

// ----- Expenses -----

async function personAccount(client: Client, userId: number, personId: number): Promise<number> {
    const found = await client.query('SELECT account_id FROM people WHERE user_id = $1 AND id = $2', [userId, personId]);
    return Number(found.rows[0].account_id);
}

const SPLIT_PROBLEMS: Record<string, string> = {
    noMembers: 'errors.groups.chooseSharers', exactTotal: 'errors.groups.exactTotal', percentTotal: 'errors.groups.percentTotal',
    badShares: 'errors.groups.badShares', badValue: 'errors.groups.badValue',
};

/**
 * { date, description, amount, paidBy: "you" | "p<id>", accountId (when the user paid), categoryId?,
 *   split: "equal" | "exact" | "percent" | "shares", parts: [{ member, value? }], treat? }.
 * Exact values are rupees; percentages are numbers adding to 100; shares are whole numbers.
 * A treat is the payer's alone: nobody owes anything for it.
 */
export async function addSharedExpense(pool: Pool, userId: number, groupId: string, body: Body): Promise<Group> {
    const date = readDate(body.date);
    const description = text(body.description);
    if (!description) throw new RequestError(400, t('errors.descriptionRequired'));
    if (description.length > 200) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.description'), max: 200 }));
    const total = amountPaise(body.amount);
    const method = String(body.split ?? 'equal') as SplitMethod;
    if (!SPLITS.includes(method)) throw new RequestError(400, t('errors.groups.badSplit'));
    return withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, groupId);
        const memberKeys = new Set(group.members.map(member => member.key));
        const paidBy = String(body.paidBy ?? YOU);
        if (!memberKeys.has(paidBy)) throw new RequestError(400, t('errors.groups.payerNotMember'));
        let parts: SplitPart[];
        if (body.treat === true) {
            parts = [{ member: paidBy, value: total }];
        } else {
            if (!Array.isArray(body.parts)) throw new RequestError(400, t('errors.groups.chooseSharers'));
            parts = (body.parts as Body[]).map(part => {
                const member = String(part?.member ?? '');
                if (!memberKeys.has(member)) throw new RequestError(400, t('errors.groups.sharerNotMember'));
                if (method === 'equal') return { member };
                const raw = String(part.value ?? '');
                let value: number;
                if (method === 'exact') {
                    try {
                        value = toPaise(raw);
                    } catch {
                        throw new RequestError(400, t('errors.groups.badValue'));
                    }
                } else if (method === 'percent') {
                    if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) throw new RequestError(400, t('errors.groups.badValue'));
                    value = Math.round(Number(raw) * 100);
                } else {
                    value = /^\d{1,3}$/.test(raw) ? Number(raw) : -1;
                }
                return { member, value };
            });
        }
        const split = splitAmount(total, body.treat === true ? 'exact' : method, parts);
        if (typeof split === 'string') throw new RequestError(400, t(SPLIT_PROBLEMS[split] as 'errors.groups.badValue'));

        const yourShare = split.get(YOU) ?? 0;
        let categoryId: number | null = null;
        if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '') {
            categoryId = (await lockedCategory(client, userId, body.categoryId, 'expense')).id;
        }
        let entryId: number | null = null;
        if (paidBy === YOU || yourShare > 0) {
            const spending = categoryId ?? await systemAccount(client, userId, 'expense');
            const lines: EntryLine[] = [];
            if (paidBy === YOU) {
                const account = await lockedMoneyAccount(client, userId, body.accountId);
                await checkCanSpend(client, userId, account, total);
                lines.push({ accountId: account.id, paise: -total }, { accountId: spending, paise: yourShare });
                for (const [member, share] of split) {
                    if (member !== YOU && share > 0) lines.push({ accountId: await personAccount(client, userId, personOf(member)!), paise: share });
                }
            } else {
                lines.push({ accountId: spending, paise: yourShare }, { accountId: await personAccount(client, userId, personOf(paidBy)!), paise: -yourShare });
            }
            entryId = await postEntry(client, { userId, date, description, type: 'shared_expense', eventId: group.event?.id ?? null, lines });
        }
        const created = await client.query(
            `INSERT INTO shared_expenses (user_id, group_id, expense_date, description, amount_paise, paid_by_person_id, split_method, category_id, entry_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [userId, group.id, date, description, total, personOf(paidBy), body.treat === true ? 'exact' : method, categoryId, entryId]);
        const expenseId = Number(created.rows[0].id);
        for (const part of parts) {
            await client.query('INSERT INTO shared_expense_shares (user_id, expense_id, person_id, share_paise, entered) VALUES ($1, $2, $3, $4, $5)',
                [userId, expenseId, personOf(part.member), split.get(part.member) ?? 0, method === 'equal' ? null : part.value ?? null]);
        }
        await logActivity(client, userId, 'created', 'group', group.id, `Shared expense in ${group.name}: ${description}`, fromPaise(total), null,
            { group: group.name, description, amount: fromPaise(total), paidBy, yourShare: fromPaise(yourShare), split: method });
        return (await loadGroups(client, userId, group.id))[0]!;
    });
}

export async function deleteSharedExpense(pool: Pool, userId: number, groupId: string, expenseId: string): Promise<Group> {
    return withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, groupId);
        const found = await client.query('SELECT id, entry_id, description, amount_paise FROM shared_expenses WHERE id = $1 AND group_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE',
            [/^\d+$/.test(expenseId) ? expenseId : 0, group.id, userId]);
        const row = found.rows[0];
        if (!row) throw new RequestError(404, t('errors.groups.expenseNotFound'));
        if (row.entry_id !== null) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE shared_expenses SET deleted_at = now() WHERE id = $1 AND user_id = $2', [row.id, userId]);
        await logActivity(client, userId, 'deleted', 'group', group.id, `Removed shared expense in ${group.name}: ${row.description}`, fromPaise(row.amount_paise),
            { description: row.description, amount: fromPaise(row.amount_paise) }, null);
        return (await loadGroups(client, userId, group.id))[0]!;
    });
}

// ----- Settling up -----

/** { from, to, amount, date, accountId (when the user pays or is paid) } */
export async function addSettlement(pool: Pool, userId: number, groupId: string, body: Body): Promise<Group> {
    const paise = amountPaise(body.amount);
    const date = readDate(body.date);
    return withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, groupId);
        const keys = new Set(group.members.map(member => member.key));
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        if (!keys.has(from) || !keys.has(to) || from === to) throw new RequestError(400, t('errors.groups.badSettlement'));
        let entryId: number | null = null;
        if (from === YOU || to === YOU) {
            const account = await lockedMoneyAccount(client, userId, body.accountId);
            const friend = await personAccount(client, userId, personOf(from === YOU ? to : from)!);
            if (from === YOU) await checkCanSpend(client, userId, account, paise);
            entryId = await postEntry(client, {
                userId, date, type: 'group_settlement', description: t('groups.entry.settled', { group: group.name }),
                lines: from === YOU ? [{ accountId: friend, paise }, { accountId: account.id, paise: -paise }] : [{ accountId: account.id, paise }, { accountId: friend, paise: -paise }],
            });
        }
        const created = await client.query(
            'INSERT INTO settlements (user_id, group_id, from_person_id, to_person_id, amount_paise, settled_on, entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [userId, group.id, personOf(from), personOf(to), paise, date, entryId]);
        await logActivity(client, userId, 'created', 'group', group.id, `Settled up in ${group.name}`, fromPaise(paise), null,
            { group: group.name, from, to, amount: fromPaise(paise), settlementId: Number(created.rows[0].id) });
        return (await loadGroups(client, userId, group.id))[0]!;
    });
}

export async function deleteSettlement(pool: Pool, userId: number, groupId: string, settlementId: string): Promise<Group> {
    return withTransaction(pool, async (client) => {
        const group = await lockedGroup(client, userId, groupId);
        const found = await client.query('SELECT id, entry_id, amount_paise FROM settlements WHERE id = $1 AND group_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE',
            [/^\d+$/.test(settlementId) ? settlementId : 0, group.id, userId]);
        const row = found.rows[0];
        if (!row) throw new RequestError(404, t('errors.groups.settlementNotFound'));
        if (row.entry_id !== null) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE settlements SET deleted_at = now() WHERE id = $1 AND user_id = $2', [row.id, userId]);
        await logActivity(client, userId, 'deleted', 'group', group.id, `Removed a settlement in ${group.name}`, fromPaise(row.amount_paise), { amount: fromPaise(row.amount_paise) }, null);
        return (await loadGroups(client, userId, group.id))[0]!;
    });
}

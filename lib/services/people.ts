import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { fromPaise, postEntry, toPaise, voidEntry } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { perHundredMonthly, personLoanState, splitRepayment, yearlyRate, type RateUnit } from '../../src/core/interest';
import { categoryByKey } from './categories';
import { checkCanSpend, lockedMoneyAccount } from './entries';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * People and money with them (v2 Phase 3, src/core/interest.ts). Each person has one ledger account
 * (subtype 'person'): positive while they owe the user, negative while the user owes them. Lending,
 * borrowing and repayments move money between it and the user's money accounts, so they are never
 * income or spending; interest paid to the user is income ("Interest"), interest the user pays is
 * spending ("Loan interest and fees"). What is left can be settled as a gift ("Gifts" given, or
 * "Gifts received"), which closes the loan.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;
type Direction = 'lent' | 'borrowed';

export interface LoanEvent {
    entryId: number;
    date: string;
    type: 'person_loan' | 'person_repayment' | 'person_settlement';
    amount: string;
    principal: string;
    interest: string;
    account: string | null;
}

export interface PersonLoan {
    id: number;
    personId: number;
    direction: Direction;
    principal: string;
    startedOn: string;
    dueOn: string | null;
    /** % a year, and the same as ₹ per ₹100 a month; null when interest-free */
    interestRate: string | null;
    perHundredMonthly: string | null;
    notes: string | null;
    outstanding: string;
    principalRepaid: string;
    interestPaid: string;
    interestDue: string;
    status: 'open' | 'overdue' | 'settled';
    closed: boolean;
    history: LoanEvent[];
}

export interface Person {
    id: number;
    name: string;
    notes: string | null;
    /** Positive: they owe the user; negative: the user owes them */
    balance: string;
    loans: PersonLoan[];
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function personName(value: unknown): string {
    const name = text(value);
    if (!name) throw new RequestError(400, t('errors.people.nameRequired'));
    if (name.length > 80) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 80 }));
    return name;
}

function optionalNotes(value: unknown): string | null {
    const notes = text(value);
    if (notes.length > 500) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.notes'), max: 500 }));
    return notes || null;
}

function amountPaise(value: unknown, message = t('errors.enterValidAmount')): number {
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, message);
    }
    if (paise <= 0) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

function readDate(value: unknown, required = true): string | null {
    if (value === undefined || value === null || value === '') {
        if (required) throw new RequestError(400, t('errors.dateRequired'));
        return null;
    }
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.invalidDateFormat'));
    return date.date;
}

/** A rate in either unit as % a year; null for interest-free */
function readRate(value: unknown, unit: unknown): string | null {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null;
    if (unit !== undefined && unit !== 'year' && unit !== 'per100month') throw new RequestError(400, t('errors.people.badRate'));
    const rate = yearlyRate(String(value), (unit ?? 'year') as RateUnit);
    if (rate === null || rate === '0') throw new RequestError(400, t('errors.people.badRate'));
    return rate;
}

// ----- Reading -----

const LOAN_QUERY = `
    SELECT pl.id, pl.person_id, pl.direction, pl.principal_paise, pl.started_on::text AS started_on, pl.due_on::text AS due_on,
           pl.interest_rate::text AS interest_rate, pl.notes, pl.closed_at,
           coalesce((SELECT json_agg(json_build_object(
                        'entryId', e.id, 'date', e.entry_date::text, 'type', e.entry_type,
                        'principal', (SELECT abs(sum(l.amount_paise)) FROM journal_lines l WHERE l.user_id = e.user_id AND l.entry_id = e.id AND l.account_id = p.account_id),
                        'interest', (SELECT coalesce(abs(sum(l.amount_paise)), 0) FROM journal_lines l JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
                                     WHERE l.user_id = e.user_id AND l.entry_id = e.id AND a.kind IN ('income', 'expense') AND e.entry_type = 'person_repayment'),
                        'account', (SELECT a.name FROM journal_lines l JOIN ledger_accounts a ON a.user_id = l.user_id AND a.id = l.account_id
                                    WHERE l.user_id = e.user_id AND l.entry_id = e.id AND a.subtype IN ('bank', 'cash', 'credit_card', 'wallet', 'meal_card') LIMIT 1))
                        ORDER BY e.entry_date, e.id)
                     FROM journal_entries e WHERE e.user_id = pl.user_id AND e.person_loan_id = pl.id AND e.voided_at IS NULL), '[]'::json) AS history
    FROM person_loans pl JOIN people p ON p.user_id = pl.user_id AND p.id = pl.person_id
    WHERE pl.user_id = $1 AND pl.deleted_at IS NULL`;

interface HistoryRow { entryId: number; date: string; type: LoanEvent['type']; principal: number | string; interest: number | string; account: string | null }

function toLoan(row: Record<string, unknown>, today: string): PersonLoan {
    const history = (row.history as HistoryRow[]).map(item => ({ ...item, principal: Number(item.principal ?? 0), interest: Number(item.interest ?? 0) }));
    const principal = Number(row.principal_paise);
    const rate = (row.interest_rate as string | null) === null ? null : String(Number(row.interest_rate));
    const repayments = history.filter(item => item.type === 'person_repayment').map(item => ({ date: item.date, principalPaise: item.principal, interestPaise: item.interest }));
    const settled = history.filter(item => item.type === 'person_settlement').reduce((sum, item) => sum + item.principal, 0);
    const state = personLoanState(principal, rate, String(row.started_on), (row.due_on as string | null) ?? null,
        settled > 0 ? [...repayments, { date: today, principalPaise: settled, interestPaise: 0 }] : repayments, today, row.closed_at !== null);
    return {
        id: Number(row.id), personId: Number(row.person_id), direction: row.direction as Direction, principal: fromPaise(principal),
        startedOn: String(row.started_on), dueOn: (row.due_on as string | null) ?? null, interestRate: rate, perHundredMonthly: rate === null ? null : perHundredMonthly(rate),
        notes: (row.notes as string | null) ?? null, outstanding: fromPaise(state.outstanding), principalRepaid: fromPaise(state.principalRepaid - settled),
        interestPaid: fromPaise(state.interestPaid), interestDue: fromPaise(state.interestDue), status: state.status, closed: row.closed_at !== null,
        history: history.map(item => ({
            entryId: Number(item.entryId), date: item.date, type: item.type, principal: fromPaise(item.principal), interest: fromPaise(item.interest),
            amount: fromPaise(item.principal + item.interest), account: item.account,
        })),
    };
}

/** The user's people (not removed), by name, each with their balance and loans; with the totals both ways */
export async function listPeople(pool: Pool, userId: number): Promise<{ people: Person[]; owedToYou: string; youOwe: string }> {
    const today = todayInIndia();
    const people = await pool.query(
        `SELECT p.id, p.name, p.notes, COALESCE(b.balance_paise, 0)::bigint AS balance_paise
         FROM people p LEFT JOIN ledger_account_balances b ON b.account_id = p.account_id
         WHERE p.user_id = $1 AND p.archived_at IS NULL ORDER BY lower(p.name)`, [userId]);
    const loans = (await pool.query(`${LOAN_QUERY} ORDER BY pl.started_on DESC, pl.id DESC`, [userId])).rows.map(row => toLoan(row, today));
    let owedToYou = 0;
    let youOwe = 0;
    const list = people.rows.map(row => {
        const balance = Number(row.balance_paise);
        if (balance > 0) owedToYou += balance;
        else youOwe -= balance;
        return {
            id: Number(row.id), name: row.name, notes: row.notes, balance: fromPaise(balance),
            loans: loans.filter(loan => loan.personId === Number(row.id)),
        };
    });
    return { people: list, owedToYou: fromPaise(owedToYou), youOwe: fromPaise(youOwe) };
}

/** People with money overdue: for the next step and the debt warnings */
export async function overdueLoans(pool: Pool, userId: number): Promise<{ person: string; loan: PersonLoan }[]> {
    const { people } = await listPeople(pool, userId);
    return people.flatMap(person => person.loans.filter(loan => loan.status === 'overdue').map(loan => ({ person: person.name, loan })));
}

// ----- People -----

async function lockedPerson(client: Client, userId: number, id: unknown): Promise<{ id: number; name: string; notes: string | null; accountId: number }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.people.notFound'));
    const result = await client.query('SELECT id, name, notes, account_id FROM people WHERE id = $1 AND user_id = $2 AND archived_at IS NULL FOR UPDATE', [id, userId]);
    if (result.rows.length === 0) throw new RequestError(404, t('errors.people.notFound'));
    const row = result.rows[0];
    return { id: Number(row.id), name: row.name, notes: row.notes, accountId: Number(row.account_id) };
}

async function refuseSameName(client: Client, userId: number, name: string, exceptId = 0): Promise<void> {
    const clash = await client.query('SELECT 1 FROM people WHERE user_id = $1 AND archived_at IS NULL AND lower(name) = lower($2) AND id <> $3', [userId, name, exceptId]);
    if (clash.rows.length > 0) throw new RequestError(400, t('errors.people.exists', { name }));
}

export async function createPerson(pool: Pool, userId: number, body: Body): Promise<{ id: number; name: string }> {
    const name = personName(body.name);
    const notes = optionalNotes(body.notes);
    return withTransaction(pool, async (client) => {
        await refuseSameName(client, userId, name);
        const account = await client.query(
            'INSERT INTO ledger_accounts (user_id, kind, subtype, name) VALUES ($1, \'asset\', \'person\', $2) RETURNING id', [userId, name]);
        const created = await client.query('INSERT INTO people (user_id, name, notes, account_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [userId, name, notes, account.rows[0].id]);
        const id = Number(created.rows[0].id);
        await logActivity(client, userId, 'created', 'person', id, `Added person: ${name}`, null, null, { name });
        return { id, name };
    });
}

export async function updatePerson(pool: Pool, userId: number, id: string, body: Body): Promise<{ id: number; name: string }> {
    return withTransaction(pool, async (client) => {
        const person = await lockedPerson(client, userId, id);
        const name = body.name === undefined ? person.name : personName(body.name);
        if (name !== person.name) await refuseSameName(client, userId, name, person.id);
        const notes = body.notes === undefined ? person.notes : optionalNotes(body.notes);
        await client.query('UPDATE people SET name = $1, notes = $2 WHERE id = $3 AND user_id = $4', [name, notes, person.id, userId]);
        await client.query('UPDATE ledger_accounts SET name = $1 WHERE id = $2 AND user_id = $3', [name, person.accountId, userId]);
        await logActivity(client, userId, 'updated', 'person', person.id, `Updated person: ${name}`, null, { name: person.name }, { name });
        return { id: person.id, name };
    });
}

/** Remove a person once nothing is owed either way; their history stays */
export async function archivePerson(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const person = await lockedPerson(client, userId, id);
        const balance = await client.query('SELECT COALESCE(balance_paise, 0)::bigint AS paise FROM ledger_account_balances WHERE account_id = $1', [person.accountId]);
        if (Number(balance.rows[0]?.paise ?? 0) !== 0) throw new RequestError(400, t('errors.people.stillOwed', { name: person.name }));
        await client.query('UPDATE people SET archived_at = now() WHERE id = $1 AND user_id = $2', [person.id, userId]);
        await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE id = $1 AND user_id = $2', [person.accountId, userId]);
        await logActivity(client, userId, 'deleted', 'person', person.id, `Removed person: ${person.name}`, null, { name: person.name }, null);
    });
}

// ----- Loans -----

/** { direction: "lent" | "borrowed", amount, accountId, date, dueOn?, interestRate?, rateUnit?: "year" | "per100month", notes? } */
export async function createPersonLoan(pool: Pool, userId: number, personId: string, body: Body): Promise<PersonLoan> {
    const direction = body.direction;
    if (direction !== 'lent' && direction !== 'borrowed') throw new RequestError(400, t('errors.people.badDirection'));
    const paise = amountPaise(body.amount);
    const date = readDate(body.date)!;
    if (date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field: t('errors.people.dateField') }));
    const dueOn = readDate(body.dueOn, false);
    if (dueOn && dueOn < date) throw new RequestError(400, t('errors.people.dueBeforeStart'));
    const rate = readRate(body.interestRate, body.rateUnit);
    const notes = optionalNotes(body.notes);
    return withTransaction(pool, async (client) => {
        const person = await lockedPerson(client, userId, personId);
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        if (direction === 'lent') await checkCanSpend(client, userId, account, paise);
        const created = await client.query(
            `INSERT INTO person_loans (user_id, person_id, direction, principal_paise, started_on, due_on, interest_rate, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [userId, person.id, direction, paise, date, dueOn, rate, notes]);
        const loanId = Number(created.rows[0].id);
        const into = direction === 'lent' ? person.accountId : account.id;
        const outOf = direction === 'lent' ? account.id : person.accountId;
        await postEntry(client, {
            userId, date, type: 'person_loan', description: t(`people.entry.${direction}`, { name: person.name }), personLoanId: loanId,
            lines: [{ accountId: into, paise }, { accountId: outOf, paise: -paise }],
        });
        await logActivity(client, userId, 'created', 'person_loan', loanId, `${direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${person.name}`, fromPaise(paise), null,
            { name: person.name, direction, amount: fromPaise(paise), date, dueOn, interestRate: rate, accountName: account.name });
        return loanById(client, userId, loanId);
    });
}

async function loanById(client: Client, userId: number, id: number): Promise<PersonLoan> {
    const row = (await client.query(`${LOAN_QUERY} AND pl.id = $2`, [userId, id])).rows[0];
    if (!row) throw new RequestError(404, t('errors.people.loanNotFound'));
    return toLoan(row, todayInIndia());
}

async function lockedLoan(client: Client, userId: number, id: unknown): Promise<PersonLoan & { personName: string; personAccountId: number }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.people.loanNotFound'));
    const locked = await client.query(
        `SELECT p.name, p.account_id FROM person_loans pl JOIN people p ON p.user_id = pl.user_id AND p.id = pl.person_id
         WHERE pl.id = $1 AND pl.user_id = $2 AND pl.deleted_at IS NULL FOR UPDATE OF pl`, [id, userId]);
    if (locked.rows.length === 0) throw new RequestError(404, t('errors.people.loanNotFound'));
    return { ...(await loanById(client, userId, Number(id))), personName: locked.rows[0].name, personAccountId: Number(locked.rows[0].account_id) };
}

/** { dueOn?, interestRate?, rateUnit?, notes? }: change a loan's terms (its amounts and payments stay) */
export async function updatePersonLoan(pool: Pool, userId: number, id: string, body: Body): Promise<PersonLoan> {
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        const dueOn = body.dueOn === undefined ? loan.dueOn : readDate(body.dueOn, false);
        if (dueOn && dueOn < loan.startedOn) throw new RequestError(400, t('errors.people.dueBeforeStart'));
        const rate = body.interestRate === undefined ? loan.interestRate : readRate(body.interestRate, body.rateUnit);
        const notes = body.notes === undefined ? loan.notes : optionalNotes(body.notes);
        await client.query('UPDATE person_loans SET due_on = $1, interest_rate = $2, notes = $3 WHERE id = $4 AND user_id = $5', [dueOn, rate, notes, loan.id, userId]);
        await logActivity(client, userId, 'updated', 'person_loan', loan.id, `Updated loan with ${loan.personName}`, null,
            { dueOn: loan.dueOn, interestRate: loan.interestRate, notes: loan.notes }, { dueOn, interestRate: rate, notes });
        return loanById(client, userId, loan.id);
    });
}

/**
 * { amount, accountId, date, interest? }: money back on a loan (from the person when lent, to them
 * when borrowed). The interest part defaults to what is due; the rest reduces what is owed.
 */
export async function recordRepayment(pool: Pool, userId: number, id: string, body: Body): Promise<PersonLoan> {
    const paise = amountPaise(body.amount);
    const date = readDate(body.date)!;
    if (date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field: t('errors.people.dateField') }));
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed || loan.status === 'settled') throw new RequestError(400, t('errors.people.settled'));
        if (date < loan.startedOn) throw new RequestError(400, t('errors.people.beforeStart'));
        // What was owed on the day of this payment: interest built up until then, not until today
        const earlier = loan.history.filter(item => item.type === 'person_repayment' && item.date <= date)
            .map(item => ({ date: item.date, principalPaise: toPaise(item.principal), interestPaise: toPaise(item.interest) }));
        const onTheDay = personLoanState(toPaise(loan.principal), loan.interestRate, loan.startedOn, loan.dueOn, earlier, date);
        const state = { outstanding: onTheDay.outstanding, interestDue: onTheDay.interestDue };
        let principal: number;
        let interest: number;
        if (body.interest === undefined || body.interest === null || body.interest === '') {
            const split = splitRepayment(paise, state);
            if (split.extra > 0) throw new RequestError(400, t('errors.people.tooMuch', { most: fromPaise(state.outstanding + state.interestDue) }));
            ({ principalPaise: principal, interestPaise: interest } = split);
        } else {
            try {
                interest = toPaise(body.interest);
            } catch {
                throw new RequestError(400, t('errors.enterValidAmount'));
            }
            if (interest < 0 || interest > paise) throw new RequestError(400, t('errors.people.badInterest'));
            principal = paise - interest;
            if (principal > state.outstanding) throw new RequestError(400, t('errors.people.tooMuch', { most: fromPaise(state.outstanding + interest) }));
        }
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        if (loan.direction === 'borrowed') await checkCanSpend(client, userId, account, paise);
        const lines = loan.direction === 'lent'
            ? [{ accountId: account.id, paise }, { accountId: loan.personAccountId, paise: -principal },
                { accountId: await categoryByKey(client, userId, 'interest', 'income'), paise: -interest }]
            : [{ accountId: loan.personAccountId, paise: principal },
                { accountId: await categoryByKey(client, userId, 'loan_interest', 'expense'), paise: interest }, { accountId: account.id, paise: -paise }];
        await postEntry(client, {
            userId, date, type: 'person_repayment', lines, personLoanId: loan.id,
            description: t(`people.entry.${loan.direction === 'lent' ? 'repaidByThem' : 'repaidByYou'}`, { name: loan.personName }),
        });
        await logActivity(client, userId, 'created', 'person_loan', loan.id, `Repayment ${loan.direction === 'lent' ? 'from' : 'to'} ${loan.personName}`, fromPaise(paise), null,
            { name: loan.personName, amount: fromPaise(paise), principal: fromPaise(principal), interest: fromPaise(interest), date, accountName: account.name });
        return loanById(client, userId, loan.id);
    });
}

/** Remove a repayment recorded by mistake: its entry is voided */
export async function deleteRepayment(pool: Pool, userId: number, id: string, entryId: string): Promise<PersonLoan> {
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        const event = loan.history.find(item => String(item.entryId) === entryId && item.type !== 'person_loan');
        if (!event) throw new RequestError(404, t('errors.people.repaymentNotFound'));
        await voidEntry(client, userId, event.entryId);
        if (event.type === 'person_settlement') await client.query('UPDATE person_loans SET closed_at = NULL WHERE id = $1 AND user_id = $2', [loan.id, userId]);
        await logActivity(client, userId, 'deleted', 'person_loan', loan.id, `Removed a ${event.type === 'person_settlement' ? 'settlement' : 'repayment'} with ${loan.personName}`,
            event.amount, { amount: event.amount, date: event.date }, null);
        return loanById(client, userId, loan.id);
    });
}

/**
 * { date? }: close a loan with something still owed. What is left becomes a gift: given (spending,
 * "Gifts") when the user lent it, received (income, "Gifts received") when they borrowed it.
 */
export async function settleAsGift(pool: Pool, userId: number, id: string, body: Body): Promise<PersonLoan> {
    const date = readDate(body.date, false) ?? todayInIndia();
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed) throw new RequestError(400, t('errors.people.settled'));
        const left = toPaise(loan.outstanding);
        if (left > 0) {
            const lines = loan.direction === 'lent'
                ? [{ accountId: await categoryByKey(client, userId, 'gifts', 'expense'), paise: left }, { accountId: loan.personAccountId, paise: -left }]
                : [{ accountId: loan.personAccountId, paise: left }, { accountId: await categoryByKey(client, userId, 'gifts_received', 'income'), paise: -left }];
            await postEntry(client, { userId, date, type: 'person_settlement', lines, personLoanId: loan.id, description: t('people.entry.settled', { name: loan.personName }) });
        }
        await client.query('UPDATE person_loans SET closed_at = now() WHERE id = $1 AND user_id = $2', [loan.id, userId]);
        await logActivity(client, userId, 'updated', 'person_loan', loan.id, `Settled loan with ${loan.personName}`, fromPaise(left), null,
            { name: loan.personName, gift: fromPaise(left), direction: loan.direction });
        return loanById(client, userId, loan.id);
    });
}

/** Remove a loan entered by mistake: every entry of it is voided (kept as history) */
export async function deletePersonLoan(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        for (const event of loan.history) await voidEntry(client, userId, event.entryId);
        await client.query('UPDATE person_loans SET deleted_at = now() WHERE id = $1 AND user_id = $2', [loan.id, userId]);
        await logActivity(client, userId, 'deleted', 'person_loan', loan.id, `Removed loan with ${loan.personName}`, loan.principal,
            { name: loan.personName, direction: loan.direction, amount: loan.principal }, null);
    });
}

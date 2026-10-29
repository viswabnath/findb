import type { Pool, PoolClient } from 'pg';
import { logActivity } from '../activity-log';
import { formatRupees } from '../format';
import { fromPaise, postEntry, systemAccount, toPaise, voidEntry, type EntryLine } from '../ledger';
import { RequestError, withTransaction } from '../transaction';
import { t } from '../i18n';
import { perHundredMonthly, yearlyRate as toYearly, type RateUnit } from '../../src/core/interest';
import {
    addMonths, byFinancialYear, effectiveYearlyRate, emiFor, foreclosureAmount, interestSaved, schedule,
    type Instalment, type Keep, type LoanTerms, type Prepayment, type RateChange,
} from '../../src/core/loans';
import { goldValuePaise, marginState, type MarginRisk } from '../../src/core/pledge';
import type { Karat } from '../../src/core/calculators';
import { ensureCategories } from './categories';
import { checkCanSpend, lockedMoneyAccount } from './entries';
import { todayInIndia } from './recurring';
import { entryDate } from './transactions';

/**
 * Loans from banks and lenders (v2 Phase 3, src/core/loans.ts). A loan is a ledger account
 * (subtype 'loan', a liability): negative while money is owed. An EMI splits into principal, which
 * reduces the loan, and interest, which is spending in "Loan interest and fees", worked out on what
 * is really owed; fees and charges are spending there too. Prepayments, top-ups and rate changes
 * recalculate the schedule. Each payment is kept (loan_payments) for the per-year figures.
 */

type Client = Pick<PoolClient, 'query'>;
type Body = Record<string, unknown>;

const KINDS = ['home', 'vehicle', 'personal', 'education', 'business', 'consumer', 'other', 'gold', 'against_fd', 'against_policy', 'against_securities', 'against_property',
    'card_emi', 'card_loan'];
/** Loans on a credit card (migration 0033): EMIs charged to the card, what is owed blocking its limit */
const ON_CARD = ['card_emi', 'card_loan'];
/** Loans that are backed by an asset, and the kind of asset each pledges */
const SECURED: Record<string, string> = { gold: 'gold', against_fd: 'fd', against_policy: 'policy', against_securities: 'securities', against_property: 'property' };
const RATE_TYPES = ['reducing', 'flat', 'interest_only', 'bullet'];

export interface Pledge {
    assetKind: string;
    description: string;
    value: string;
    valuedOn: string;
    weightGrams: string | null;
    purityKarat: number | null;
    /** ₹ a gram of 24 karat gold, as last valued */
    goldRate: string | null;
    ltvLimit: string;
    /** The loan (with interest due on a bullet loan) as % of the asset's value, and the margin risk */
    ltv: number;
    risk: MarginRisk;
    /** How far the asset's value can fall before the limit */
    headroom: string;
    /** The asset's value less what is owed against it */
    available: string;
    released: boolean;
}

export interface LoanPayment {
    id: number; kind: string; date: string; principal: string; interest: string; charges: string; total: string;
    keep: Keep | null; status: 'full' | 'partial' | 'late' | null;
}

export interface Loan {
    id: number;
    name: string;
    lender: string | null;
    kind: string;
    rateType: 'reducing' | 'flat' | 'interest_only' | 'bullet';
    rateKind: 'fixed' | 'floating';
    principal: string;
    /** The rate now: % a year and ₹ per ₹100 a month */
    yearlyRate: string;
    /** The rate the loan started at (later changes are in rateChanges) */
    startRate: string;
    perHundredMonthly: string;
    months: number;
    disbursedOn: string;
    firstDue: string;
    emi: string;
    /** The true yearly cost with fees (and for a flat rate, far above the quoted one) */
    effectiveRate: number;
    outstanding: string;
    principalRepaid: string;
    interestPaid: string;
    feesPaid: string;
    /** The next instalment, and EMIs due since tracking began that have no payment */
    nextDue: { date: string; amount: string } | null;
    missed: number;
    /** Instalments left on the schedule, and its end */
    monthsLeft: number;
    endsOn: string | null;
    foreclosure: { interest: string; charge: string; total: string } | null;
    byYear: { year: string; principal: string; interest: string; fees: string }[];
    schedule: { number: number; date: string; emi: string; interest: string; principal: string; prepaid: string; closing: string; yearlyRate: number }[];
    rateChanges: { from: string; yearlyRate: string; keep: Keep }[];
    payments: LoanPayment[];
    closed: boolean;
    notes: string | null;
    pledge: Pledge | null;
    /** The card a card EMI or card loan is on (its ledger account id) */
    cardId: number | null;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function paiseOf(value: unknown, allowZero = false): number {
    if ((value === undefined || value === null || value === '') && allowZero) return 0;
    let paise: number;
    try {
        paise = toPaise(value);
    } catch {
        throw new RequestError(400, t('errors.enterValidAmount'));
    }
    if (paise < 0 || (paise === 0 && !allowZero)) throw new RequestError(400, t('errors.enterAmountGreaterThanZero'));
    return paise;
}

function dateOf(value: unknown, field: string, allowFuture = false): string {
    if (!value) throw new RequestError(400, t('errors.fieldRequired', { field }));
    const date = entryDate(value);
    if (!date) throw new RequestError(400, t('errors.fieldNotValidDate', { field }));
    if (!allowFuture && date.date > todayInIndia()) throw new RequestError(400, t('errors.fieldInFuture', { field }));
    return date.date;
}

function rateOf(value: unknown, unit: unknown): string {
    if (unit !== undefined && unit !== 'year' && unit !== 'per100month') throw new RequestError(400, t('errors.loans.badRate'));
    const rate = value === 0 || value === '0' ? '0' : toYearly(String(value ?? ''), (unit ?? 'year') as RateUnit);
    if (rate === null) throw new RequestError(400, t('errors.loans.badRate'));
    return rate;
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// ----- Reading -----

interface LoanRow {
    id: string; account_id: string; name: string; lender: string | null; loan_kind: string; rate_type: 'reducing' | 'flat'; rate_kind: 'fixed' | 'floating';
    principal_paise: string; yearly_rate: string; months: number; disbursed_on: string; first_due: string; tracked_from: string; emi_paise: string;
    processing_fee_paise: string; other_charges_paise: string; foreclosure_charge: string; notes: string | null; closed_on: string | null; balance_paise: string;
    card_account_id: string | null;
}

async function loadLoans(client: Client, userId: number, onlyId?: number): Promise<Loan[]> {
    const loans = await client.query(
        `SELECT l.id, l.account_id, l.name, l.lender, l.loan_kind, l.rate_type, l.rate_kind, l.principal_paise, l.yearly_rate::text AS yearly_rate, l.months,
                l.disbursed_on::text AS disbursed_on, l.first_due::text AS first_due, l.tracked_from::text AS tracked_from, l.emi_paise,
                l.processing_fee_paise, l.other_charges_paise, l.foreclosure_charge::text AS foreclosure_charge, l.notes, l.closed_on::text AS closed_on, l.card_account_id,
                COALESCE(b.balance_paise, 0)::bigint AS balance_paise
         FROM loans l LEFT JOIN ledger_account_balances b ON b.account_id = l.account_id
         WHERE l.user_id = $1 AND l.deleted_at IS NULL AND ($2::bigint IS NULL OR l.id = $2)
         ORDER BY l.closed_on IS NOT NULL, l.disbursed_on DESC, l.id DESC`, [userId, onlyId ?? null]);
    if (loans.rows.length === 0) return [];
    const ids = loans.rows.map(row => Number(row.id));
    const changes = (await client.query(
        `SELECT loan_id, effective_from::text AS effective_from, yearly_rate::text AS yearly_rate, keep FROM loan_rate_changes
         WHERE user_id = $1 AND loan_id = ANY($2::bigint[]) ORDER BY effective_from, id`, [userId, ids])).rows;
    const payments = (await client.query(
        `SELECT id, loan_id, kind, paid_on::text AS paid_on, principal_paise, interest_paise, charges_paise, keep, status FROM loan_payments
         WHERE user_id = $1 AND loan_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY paid_on, id`, [userId, ids])).rows;
    const pledges = (await client.query(
        `SELECT loan_id, asset_kind, description, value_paise, valued_on::text AS valued_on, weight_grams::text AS weight_grams, purity_karat,
                gold_rate_paise, ltv_limit::text AS ltv_limit, released_on FROM pledges WHERE user_id = $1 AND loan_id = ANY($2::bigint[])`, [userId, ids])).rows;
    const today = todayInIndia();
    return (loans.rows as LoanRow[]).map(row => {
        const loan = toLoan(row, changes.filter(item => Number(item.loan_id) === Number(row.id)), payments.filter(item => Number(item.loan_id) === Number(row.id)), today);
        const pledge = pledges.find(item => Number(item.loan_id) === loan.id);
        return { ...loan, pledge: pledge ? toPledge(pledge, loan, today) : null };
    });
}

function toPledge(row: Record<string, unknown>, loan: Omit<Loan, 'pledge'>, today: string): Pledge {
    const value = Number(row.value_paise);
    // A bullet loan's interest builds up and is owed at the end: it counts against the gold too
    const accrued = loan.rateType === 'bullet' && !loan.closed
        ? Math.round((toPaise(loan.outstanding) * Number(loan.yearlyRate) * Math.max(day(today) - day(loan.disbursedOn), 0)) / 365 / 100) - toPaise(loan.interestPaid)
        : 0;
    const owed = toPaise(loan.outstanding) + Math.max(accrued, 0);
    const state = marginState(owed, value, Number(row.ltv_limit));
    return {
        assetKind: String(row.asset_kind), description: String(row.description), value: fromPaise(value), valuedOn: String(row.valued_on),
        weightGrams: row.weight_grams === null ? null : String(Number(row.weight_grams)), purityKarat: row.purity_karat === null ? null : Number(row.purity_karat),
        goldRate: row.gold_rate_paise === null ? null : fromPaise(Number(row.gold_rate_paise)), ltvLimit: String(Number(row.ltv_limit)),
        ltv: state.ltv, risk: loan.closed ? 'ok' : state.risk, headroom: fromPaise(state.headroom), available: fromPaise(Math.max(value - owed, 0)),
        released: row.released_on !== null || loan.closed,
    };
}

/** { assetKind?, description, value?, weightGrams?, purityKarat?, goldRate?, ltvLimit? } for a secured loan; gold is valued from weight, purity and rate */
function readPledge(body: unknown, assetKind: string): { assetKind: string; description: string; value: number; weight: string | null; karat: number | null; rate: number | null; limit: number } {
    const pledge = (body && typeof body === 'object' ? body : {}) as Body;
    const description = text(pledge.description).slice(0, 200) || t(`loans.assets.${assetKind as 'gold'}`);
    const limit = pledge.ltvLimit === undefined || pledge.ltvLimit === '' ? 75 : Number(pledge.ltvLimit);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 100) throw new RequestError(400, t('errors.loans.badLtv'));
    if (assetKind === 'gold') {
        const weight = Number(pledge.weightGrams);
        const karat = Number(pledge.purityKarat);
        if (!Number.isFinite(weight) || weight <= 0 || weight > 100_000) throw new RequestError(400, t('errors.loans.badWeight'));
        if (![24, 22, 18, 14].includes(karat)) throw new RequestError(400, t('errors.loans.badPurity'));
        const rate = paiseOf(pledge.goldRate);
        return { assetKind, description, value: goldValuePaise(weight, karat as Karat, rate), weight: String(weight), karat, rate, limit };
    }
    return { assetKind, description, value: paiseOf(pledge.value), weight: null, karat: null, rate: null, limit };
}

function toLoan(row: LoanRow, changeRows: Record<string, unknown>[], paymentRows: Record<string, unknown>[], today: string): Omit<Loan, 'pledge'> {
    const principal = Number(row.principal_paise);
    const terms: LoanTerms = { principal, yearlyRate: Number(row.yearly_rate), months: row.months, firstDue: row.first_due, type: row.rate_type };
    const changes: RateChange[] = changeRows.map(item => ({ from: String(item.effective_from), yearlyRate: Number(item.yearly_rate), keep: item.keep as Keep }));
    const payments: LoanPayment[] = paymentRows.map(item => {
        const p = Number(item.principal_paise);
        const i = Number(item.interest_paise);
        const c = Number(item.charges_paise);
        return {
            id: Number(item.id), kind: String(item.kind), date: String(item.paid_on), principal: fromPaise(p), interest: fromPaise(i), charges: fromPaise(c),
            total: fromPaise(Math.abs(p) + i + c), keep: (item.keep as Keep | null) ?? null, status: (item.status as LoanPayment['status']) ?? null,
        };
    });
    // Prepayments and top-ups change the schedule (a top-up is a prepayment the other way)
    const prepayments: Prepayment[] = payments.filter(item => item.kind === 'prepayment' || item.kind === 'topup')
        .map(item => ({ date: item.date, paise: item.kind === 'topup' ? -Math.abs(toPaise(item.principal)) : toPaise(item.principal), keep: item.keep ?? 'emi' }));
    const rows: Instalment[] = schedule(terms, changes, prepayments);
    const outstanding = Math.max(-Number(row.balance_paise), 0);
    const rate = [...changes].reverse().find(change => change.from <= today)?.yearlyRate ?? terms.yearlyRate;
    const emisPaid = payments.filter(item => item.kind === 'emi').length;
    const tracked = rows.filter(item => item.date >= row.tracked_from && item.emi > 0);
    // An EMI due today is not missed yet: only those whose date has passed
    const dueSoFar = tracked.filter(item => item.date < today).length;
    const closed = row.closed_on !== null || outstanding === 0;
    const next = closed ? null : tracked[emisPaid] ?? null;
    const sums = payments.reduce((total, item) => ({
        principal: total.principal + (item.kind === 'emi' || item.kind === 'prepayment' || item.kind === 'closure' ? toPaise(item.principal) : 0),
        interest: total.interest + toPaise(item.interest), fees: total.fees + toPaise(item.charges),
    }), { principal: 0, interest: 0, fees: 0 });
    const lastPaid = [...payments].reverse().find(item => item.kind === 'emi' || item.kind === 'prepayment')?.date ?? row.disbursed_on;
    const quote = closed ? null : foreclosureAmount(outstanding, rate, day(today) - day(lastPaid), Number(row.foreclosure_charge));
    const remaining = rows.filter(item => item.date > today && item.emi > 0);
    return {
        id: Number(row.id), name: row.name, lender: row.lender, kind: row.loan_kind, rateType: row.rate_type, rateKind: row.rate_kind,
        principal: fromPaise(principal), yearlyRate: String(rate), startRate: String(Number(row.yearly_rate)), perHundredMonthly: perHundredMonthly(String(rate)), months: row.months,
        disbursedOn: row.disbursed_on, firstDue: row.first_due, emi: fromPaise(next?.emi ?? Number(row.emi_paise)),
        effectiveRate: effectiveYearlyRate(principal, Number(row.processing_fee_paise) + Number(row.other_charges_paise), rows),
        outstanding: fromPaise(outstanding), principalRepaid: fromPaise(sums.principal), interestPaid: fromPaise(sums.interest), feesPaid: fromPaise(sums.fees),
        nextDue: next ? { date: next.date, amount: fromPaise(next.emi) } : null,
        missed: closed ? 0 : Math.max(dueSoFar - emisPaid, 0),
        monthsLeft: closed ? 0 : remaining.length, endsOn: closed ? null : rows.at(-1)?.date ?? null,
        foreclosure: quote ? { interest: fromPaise(quote.interest), charge: fromPaise(quote.charge), total: fromPaise(quote.total) } : null,
        byYear: byFinancialYear(payments.filter(item => item.kind !== 'opening' && item.kind !== 'disbursal' && item.kind !== 'topup').map(item => ({
            date: item.date, principal: toPaise(item.principal), interest: toPaise(item.interest), fees: toPaise(item.charges),
        }))).map(item => ({ year: item.year, principal: fromPaise(item.principal), interest: fromPaise(item.interest), fees: fromPaise(item.fees) })),
        schedule: rows.map(item => ({
            number: item.number, date: item.date, emi: fromPaise(item.emi), interest: fromPaise(item.interest), principal: fromPaise(item.principal),
            prepaid: fromPaise(item.prepaid), closing: fromPaise(item.closing), yearlyRate: item.yearlyRate,
        })),
        rateChanges: changes.map(change => ({ from: change.from, yearlyRate: String(change.yearlyRate), keep: change.keep })),
        payments, closed, notes: row.notes, cardId: row.card_account_id === null ? null : Number(row.card_account_id),
    };
}

export async function listLoans(pool: Pool, userId: number): Promise<Loan[]> {
    return loadLoans(pool, userId);
}

async function lockedLoan(client: Client, userId: number, id: unknown): Promise<Loan & { accountId: number }> {
    if (!/^\d+$/.test(String(id ?? ''))) throw new RequestError(404, t('errors.loans.notFound'));
    const lock = await client.query('SELECT account_id FROM loans WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, userId]);
    if (lock.rows.length === 0) throw new RequestError(404, t('errors.loans.notFound'));
    return { ...(await loadLoans(client, userId, Number(id)))[0]!, accountId: Number(lock.rows[0].account_id) };
}

async function interestCategory(client: Client, userId: number): Promise<number> {
    await ensureCategories(client, userId);
    const found = await client.query("SELECT id FROM ledger_accounts WHERE user_id = $1 AND category_key = 'loan_interest' AND archived_at IS NULL", [userId]);
    return found.rows[0] ? Number(found.rows[0].id) : systemAccount(client, userId, 'expense');
}

async function record(client: Client, userId: number, loanId: number, kind: string, date: string, description: string, lines: EntryLine[],
    parts: { principal?: number; interest?: number; charges?: number; keep?: Keep | null; status?: string | null }): Promise<void> {
    const entryId = await postEntry(client, { userId, date, description, type: 'loan', lines });
    await client.query(
        `INSERT INTO loan_payments (user_id, loan_id, kind, paid_on, principal_paise, interest_paise, charges_paise, keep, status, entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [userId, loanId, kind, date, parts.principal ?? 0, parts.interest ?? 0, parts.charges ?? 0, parts.keep ?? null, parts.status ?? null, entryId]);
}

// ----- Adding a loan -----

/**
 * { name, lender?, kind, rateType, rateKind, principal, interestRate, rateUnit?, months, disbursedOn, firstDue?, emi?,
 *   processingFee?, otherCharges?, foreclosureCharge?, notes?, accountId (a new loan: where the money came in) |
 *   outstanding (a loan already running: what is owed today) }
 */
export async function createLoan(pool: Pool, userId: number, body: Body): Promise<Loan> {
    const name = text(body.name);
    if (!name) throw new RequestError(400, t('errors.loans.nameRequired'));
    if (name.length > 80) throw new RequestError(400, t('errors.fieldTooLong', { field: t('errors.fields.name'), max: 80 }));
    const lender = text(body.lender).slice(0, 100) || null;
    const kind = String(body.kind ?? 'other');
    if (!KINDS.includes(kind)) throw new RequestError(400, t('errors.loans.badKind'));
    const rateType = RATE_TYPES.includes(String(body.rateType)) ? String(body.rateType) : 'reducing';
    const pledge = SECURED[kind] ? readPledge(body.pledge, SECURED[kind]!) : null;
    const rateKind = body.rateKind === 'floating' ? 'floating' : 'fixed';
    const principal = paiseOf(body.principal);
    const rate = rateOf(body.interestRate, body.rateUnit);
    const months = Number(body.months);
    if (!Number.isInteger(months) || months < 1 || months > 480) throw new RequestError(400, t('errors.loans.badMonths'));
    const disbursedOn = dateOf(body.disbursedOn, t('errors.loans.disbursedField'));
    const firstDue = body.firstDue ? dateOf(body.firstDue, t('errors.loans.firstDueField'), true) : addMonths(disbursedOn, 1);
    if (firstDue < disbursedOn) throw new RequestError(400, t('errors.loans.firstDueEarly'));
    const fee = paiseOf(body.processingFee, true);
    const charges = paiseOf(body.otherCharges, true);
    const foreclosure = body.foreclosureCharge === undefined || body.foreclosureCharge === '' ? 0 : Number(body.foreclosureCharge);
    if (!Number.isFinite(foreclosure) || foreclosure < 0 || foreclosure > 10) throw new RequestError(400, t('errors.loans.badForeclosure'));
    const emi = body.emi ? paiseOf(body.emi) : emiFor(principal, Number(rate), months);
    const notes = text(body.notes).slice(0, 500) || null;
    const existing = body.outstanding !== undefined && body.outstanding !== null && body.outstanding !== '';
    const outstanding = existing ? paiseOf(body.outstanding, true) : 0;
    if (existing && outstanding > principal) throw new RequestError(400, t('errors.loans.outstandingAbovePrincipal'));
    const today = todayInIndia();
    const onCard = ON_CARD.includes(kind);
    return withTransaction(pool, async (client) => {
        const card = onCard ? await lockedMoneyAccount(client, userId, body.cardId, t('errors.loans.cardField')) : null;
        if (card && card.type !== 'credit_card') throw new RequestError(400, t('errors.loans.notACard'));
        const account = await client.query('INSERT INTO ledger_accounts (user_id, kind, subtype, name, institution) VALUES ($1, \'liability\', \'loan\', $2, $3) RETURNING id',
            [userId, name, lender]);
        const accountId = Number(account.rows[0].id);
        const created = await client.query(
            `INSERT INTO loans (user_id, account_id, name, lender, loan_kind, rate_type, rate_kind, principal_paise, yearly_rate, months, disbursed_on, first_due,
                                tracked_from, emi_paise, processing_fee_paise, other_charges_paise, foreclosure_charge, notes, card_account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
            [userId, accountId, name, lender, kind, rateType, rateKind, principal, rate, months, disbursedOn, firstDue,
                existing ? (today > firstDue ? today : firstDue) : firstDue, emi, fee, charges, foreclosure, notes, card?.id ?? null]);
        const loanId = Number(created.rows[0].id);
        if (existing) {
            // Already running: what is owed today, from an opening balance; the earlier payments happened before FinDB
            const openingBalance = await systemAccount(client, userId, 'opening_balance');
            await record(client, userId, loanId, 'opening', today, t('loans.entry.opening', { name }),
                [{ accountId, paise: -outstanding }, { accountId: openingBalance, paise: outstanding }], { principal: principal - outstanding });
        } else if (kind === 'card_emi') {
            // A purchase on the card turned into EMIs: what the card owes for it moves to the loan
            if (-toPaise(card!.balance) < principal) throw new RequestError(400, t('errors.loans.cardOwesLess', { name: card!.name, owed: formatRupees(card!.used) }));
            await record(client, userId, loanId, 'disbursal', disbursedOn, t('loans.entry.converted', { name }),
                [{ accountId: card!.id, paise: principal }, { accountId, paise: -principal }], { principal: -principal });
        } else {
            const into = await lockedMoneyAccount(client, userId, body.accountId);
            await record(client, userId, loanId, 'disbursal', disbursedOn, t('loans.entry.received', { name }),
                [{ accountId: into.id, paise: principal }, { accountId, paise: -principal }], { principal: -principal });
        }
        if (!existing && fee + charges > 0) {
            // Fees on a card loan or card EMI are charged to the card; on other loans they come out of the money received
            const payer = card?.id ?? (await lockedMoneyAccount(client, userId, body.accountId)).id;
            await record(client, userId, loanId, 'fee', disbursedOn, t('loans.entry.fees', { name }),
                [{ accountId: await interestCategory(client, userId), paise: fee + charges }, { accountId: payer, paise: -(fee + charges) }], { charges: fee + charges });
        }
        if (pledge) {
            await client.query(
                `INSERT INTO pledges (user_id, loan_id, asset_kind, description, value_paise, valued_on, weight_grams, purity_karat, gold_rate_paise, ltv_limit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [userId, loanId, pledge.assetKind, pledge.description, pledge.value, today, pledge.weight, pledge.karat, pledge.rate, pledge.limit]);
        }
        await logActivity(client, userId, 'created', 'loan', loanId, `Added loan: ${name}`, fromPaise(principal), null,
            { name, lender, kind, principal: fromPaise(principal), rate, months, existing, outstanding: existing ? fromPaise(outstanding) : null });
        return (await loadLoans(client, userId, loanId))[0]!;
    });
}

// ----- Payments -----

/** { amount, accountId, date, interest? }: an EMI; the interest defaults to a month's on what is owed */
export async function payEmi(pool: Pool, userId: number, id: string, body: Body): Promise<Loan> {
    const amount = paiseOf(body.amount);
    const date = dateOf(body.date, t('errors.people.dateField'));
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed) throw new RequestError(400, t('errors.loans.closed'));
        const owed = toPaise(loan.outstanding);
        const rate = Number([...loan.rateChanges].reverse().find(change => change.from <= date)?.yearlyRate ?? loan.yearlyRate);
        const due = loan.nextDue;
        // Flat, interest-only and bullet loans: the interest is the schedule's (a bullet's is all of it, less what was paid)
        const scheduled = due ? toPaise(loan.schedule.find(row => row.date === due.date)?.interest ?? '0') : 0;
        const flatInterest = loan.rateType === 'flat' || loan.rateType === 'interest_only' ? scheduled
            : loan.rateType === 'bullet' ? Math.max(scheduled - toPaise(loan.interestPaid), 0) : null;
        let interest: number;
        if (body.interest === undefined || body.interest === null || body.interest === '') {
            interest = Math.min(flatInterest ?? Math.round((owed * rate) / 12 / 100), amount);
        } else {
            interest = paiseOf(body.interest, true);
            if (interest > amount) throw new RequestError(400, t('errors.people.badInterest'));
        }
        const principal = amount - interest;
        if (principal > owed) throw new RequestError(400, t('errors.loans.tooMuch', { most: fromPaise(owed + interest) }));
        const account = await lockedMoneyAccount(client, userId, body.accountId ?? loan.cardId);
        // An EMI charged to the card the loan is on frees the principal it repays: only the interest uses up limit
        await checkCanSpend(client, userId, account, account.id === loan.cardId ? interest : amount);
        const status = due && amount < toPaise(due.amount) ? 'partial' : due && date > due.date ? 'late' : 'full';
        await record(client, userId, loan.id, 'emi', date, t('loans.entry.emi', { name: loan.name }),
            [{ accountId: loan.accountId, paise: principal }, { accountId: await interestCategory(client, userId), paise: interest }, { accountId: account.id, paise: -amount }],
            { principal, interest, status });
        await logActivity(client, userId, 'created', 'loan', loan.id, `EMI for ${loan.name}`, fromPaise(amount), null,
            { name: loan.name, amount: fromPaise(amount), principal: fromPaise(principal), interest: fromPaise(interest), date, status });
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

/** { amount, accountId, date, keep: "emi" (finish sooner) | "tenure" (lower EMI), charges? }: a part payment; returns the loan and the interest it saves */
export async function prepay(pool: Pool, userId: number, id: string, body: Body): Promise<Loan & { interestSaved: string }> {
    const amount = paiseOf(body.amount);
    const date = dateOf(body.date, t('errors.people.dateField'));
    const keep: Keep = body.keep === 'tenure' ? 'tenure' : 'emi';
    const charges = paiseOf(body.charges, true);
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed) throw new RequestError(400, t('errors.loans.closed'));
        if (amount > toPaise(loan.outstanding)) throw new RequestError(400, t('errors.loans.tooMuch', { most: loan.outstanding }));
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        await checkCanSpend(client, userId, account, amount + charges);
        const terms: LoanTerms = { principal: toPaise(loan.principal), yearlyRate: Number(loan.startRate), months: loan.months, firstDue: loan.firstDue, type: loan.rateType };
        const before = loan.payments.filter(item => item.kind === 'prepayment' || item.kind === 'topup')
            .map(item => ({ date: item.date, paise: item.kind === 'topup' ? -Math.abs(toPaise(item.principal)) : toPaise(item.principal), keep: item.keep ?? 'emi' as Keep }));
        const changes = loan.rateChanges.map(change => ({ from: change.from, yearlyRate: Number(change.yearlyRate), keep: change.keep }));
        const saved = loan.rateType === 'flat' ? 0 : interestSaved(terms, changes, before, { date, paise: amount, keep });
        const lines: EntryLine[] = [{ accountId: loan.accountId, paise: amount }, { accountId: account.id, paise: -(amount + charges) }];
        if (charges > 0) lines.push({ accountId: await interestCategory(client, userId), paise: charges });
        await record(client, userId, loan.id, 'prepayment', date, t('loans.entry.prepayment', { name: loan.name }), lines, { principal: amount, charges, keep });
        await logActivity(client, userId, 'created', 'loan', loan.id, `Prepaid ${loan.name}`, fromPaise(amount), null,
            { name: loan.name, amount: fromPaise(amount), keep, interestSaved: fromPaise(saved), date });
        return { ...(await loadLoans(client, userId, loan.id))[0]!, interestSaved: fromPaise(saved) };
    });
}

/** { amount, accountId, date }: more money on the same loan; the EMI is worked out again for the months left */
export async function topUp(pool: Pool, userId: number, id: string, body: Body): Promise<Loan> {
    const amount = paiseOf(body.amount);
    const date = dateOf(body.date, t('errors.people.dateField'));
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed) throw new RequestError(400, t('errors.loans.closed'));
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        // A top-up keeps the end date: the EMI goes up
        await record(client, userId, loan.id, 'topup', date, t('loans.entry.topup', { name: loan.name }),
            [{ accountId: account.id, paise: amount }, { accountId: loan.accountId, paise: -amount }], { principal: -amount, keep: 'tenure' });
        await logActivity(client, userId, 'created', 'loan', loan.id, `Top-up on ${loan.name}`, fromPaise(amount), null, { name: loan.name, amount: fromPaise(amount), date });
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

/** { from, interestRate, rateUnit?, keep: "tenure" | "emi" }: a floating rate changed; the schedule follows */
export async function changeRate(pool: Pool, userId: number, id: string, body: Body): Promise<Loan> {
    const from = dateOf(body.from, t('errors.loans.fromField'), true);
    const rate = rateOf(body.interestRate, body.rateUnit);
    const keep: Keep = body.keep === 'emi' ? 'emi' : 'tenure';
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (from < loan.disbursedOn) throw new RequestError(400, t('errors.loans.rateBeforeLoan'));
        await client.query('INSERT INTO loan_rate_changes (user_id, loan_id, effective_from, yearly_rate, keep) VALUES ($1, $2, $3, $4, $5)', [userId, loan.id, from, rate, keep]);
        await logActivity(client, userId, 'updated', 'loan', loan.id, `Rate changed on ${loan.name}`, null, { rate: loan.yearlyRate }, { rate, from, keep });
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

/** { accountId, date }: close the loan today for its foreclosure amount (the balance, interest since the last EMI, the charge) */
export async function closeLoan(pool: Pool, userId: number, id: string, body: Body): Promise<Loan> {
    const date = dateOf(body.date ?? todayInIndia(), t('errors.people.dateField'));
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (loan.closed || !loan.foreclosure) throw new RequestError(400, t('errors.loans.closed'));
        const owed = toPaise(loan.outstanding);
        const interest = toPaise(loan.foreclosure.interest);
        const charge = toPaise(loan.foreclosure.charge);
        const account = await lockedMoneyAccount(client, userId, body.accountId);
        await checkCanSpend(client, userId, account, owed + interest + charge);
        await record(client, userId, loan.id, 'closure', date, t('loans.entry.closed', { name: loan.name }),
            [{ accountId: loan.accountId, paise: owed }, { accountId: await interestCategory(client, userId), paise: interest + charge }, { accountId: account.id, paise: -(owed + interest + charge) }],
            { principal: owed, interest, charges: charge });
        await client.query('UPDATE loans SET closed_on = $1 WHERE id = $2 AND user_id = $3', [date, loan.id, userId]);
        await client.query('UPDATE pledges SET released_on = $1 WHERE loan_id = $2 AND user_id = $3', [date, loan.id, userId]);
        await logActivity(client, userId, 'updated', 'loan', loan.id, `Closed ${loan.name}`, fromPaise(owed + interest + charge), null,
            { name: loan.name, principal: fromPaise(owed), interest: fromPaise(interest), charge: fromPaise(charge), date });
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

/** Remove a payment entered by mistake: its entry is voided */
export async function deleteLoanPayment(pool: Pool, userId: number, id: string, paymentId: string): Promise<Loan> {
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        const payment = loan.payments.find(item => String(item.id) === paymentId && !['opening', 'disbursal'].includes(item.kind));
        if (!payment) throw new RequestError(404, t('errors.loans.paymentNotFound'));
        const row = await client.query('SELECT entry_id FROM loan_payments WHERE id = $1 AND user_id = $2', [payment.id, userId]);
        if (row.rows[0]?.entry_id) await voidEntry(client, userId, Number(row.rows[0].entry_id));
        await client.query('UPDATE loan_payments SET deleted_at = now() WHERE id = $1 AND user_id = $2', [payment.id, userId]);
        if (payment.kind === 'closure') {
            await client.query('UPDATE loans SET closed_on = NULL WHERE id = $1 AND user_id = $2', [loan.id, userId]);
            await client.query('UPDATE pledges SET released_on = NULL WHERE loan_id = $1 AND user_id = $2', [loan.id, userId]);
        }
        await logActivity(client, userId, 'deleted', 'loan', loan.id, `Removed a payment on ${loan.name}`, payment.total, { kind: payment.kind, amount: payment.total, date: payment.date }, null);
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

/** Remove a loan entered by mistake: every entry of it is voided, its account archived */
export async function deleteLoan(pool: Pool, userId: number, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        const entries = await client.query('SELECT entry_id FROM loan_payments WHERE loan_id = $1 AND user_id = $2 AND entry_id IS NOT NULL AND deleted_at IS NULL', [loan.id, userId]);
        for (const row of entries.rows) await voidEntry(client, userId, Number(row.entry_id));
        await client.query('UPDATE loans SET deleted_at = now() WHERE id = $1 AND user_id = $2', [loan.id, userId]);
        await client.query('UPDATE ledger_accounts SET archived_at = now() WHERE id = $1 AND user_id = $2', [loan.accountId, userId]);
        await logActivity(client, userId, 'deleted', 'loan', loan.id, `Removed loan: ${loan.name}`, loan.principal, { name: loan.name }, null);
    });
}

/** { goldRate?, value?, ltvLimit?, description? }: value the pledged asset again (gold at today's rate) */
export async function revaluePledge(pool: Pool, userId: number, id: string, body: Body): Promise<Loan> {
    return withTransaction(pool, async (client) => {
        const loan = await lockedLoan(client, userId, id);
        if (!loan.pledge) throw new RequestError(400, t('errors.loans.noPledge'));
        const current = loan.pledge;
        const next = readPledge({
            description: body.description ?? current.description, ltvLimit: body.ltvLimit ?? current.ltvLimit,
            weightGrams: current.weightGrams, purityKarat: current.purityKarat, goldRate: body.goldRate ?? current.goldRate, value: body.value ?? current.value,
        }, current.assetKind);
        await client.query(
            'UPDATE pledges SET description = $1, value_paise = $2, valued_on = $3, gold_rate_paise = $4, ltv_limit = $5 WHERE loan_id = $6 AND user_id = $7',
            [next.description, next.value, todayInIndia(), next.rate, next.limit, loan.id, userId]);
        await logActivity(client, userId, 'updated', 'loan', loan.id, `Valued again: ${current.description}`, fromPaise(next.value),
            { value: current.value, goldRate: current.goldRate }, { value: fromPaise(next.value), goldRate: next.rate === null ? null : fromPaise(next.rate) });
        return (await loadLoans(client, userId, loan.id))[0]!;
    });
}

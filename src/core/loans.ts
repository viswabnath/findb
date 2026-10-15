/**
 * Loans from banks and lenders (v2 plan, Phase 3): the repayment schedule in whole paise, with
 * floating-rate changes and prepayments, flat-rate loans, the effective yearly rate (fees
 * included), and what was paid in each of India's financial years. Pure arithmetic: the server
 * records the actual payments, and compares them with this schedule.
 *
 * Interest is charged monthly on the balance (monthly rest), as Indian banks do; the EMI is
 * rounded to the rupee, and the last instalment takes whatever is left.
 */
import { irr } from './calculators';

/** reducing: EMIs on the balance; flat: interest on the whole amount; interest_only: monthly interest, the principal at the end; bullet: everything at the end (gold loans) */
export type LoanType = 'reducing' | 'flat' | 'interest_only' | 'bullet';
/** After a rate change or a prepayment: keep the tenure (the EMI changes) or keep the EMI (the tenure changes) */
export type Keep = 'tenure' | 'emi';

export interface LoanTerms {
    principal: number;
    /** % a year, 8.5 is 8.5% */
    yearlyRate: number;
    months: number;
    /** The first EMI's date, YYYY-MM-DD; the rest fall on the same day of each month */
    firstDue: string;
    type: LoanType;
}

export interface RateChange { from: string; yearlyRate: number; keep: Keep }
export interface Prepayment { date: string; paise: number; keep: Keep }

export interface Instalment {
    number: number;
    date: string;
    opening: number;
    emi: number;
    interest: number;
    principal: number;
    /** A prepayment made just before this instalment */
    prepaid: number;
    closing: number;
    yearlyRate: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A date some months later on the same day, or the month's last day when it is shorter */
export function addMonths(date: string, months: number): string {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const index = y * 12 + (m - 1) + months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${pad(month)}-${pad(Math.min(d, daysIn(year, month)))}`;
}

/** The EMI of a reducing-balance loan, rounded up to the rupee (banks never let it fall short) */
export function emiFor(principal: number, yearlyRate: number, months: number): number {
    if (months <= 0) return principal;
    const r = yearlyRate / 12 / 100;
    const exact = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
    return Math.ceil(exact / 100) * 100;
}

/** The months a balance takes to clear at an EMI and rate; Infinity if the EMI does not cover the interest */
export function monthsFor(balance: number, yearlyRate: number, emi: number): number {
    const r = yearlyRate / 12 / 100;
    if (r === 0) return Math.ceil(balance / emi);
    if (emi <= balance * r) return Infinity;
    return Math.ceil(-Math.log(1 - (balance * r) / emi) / Math.log(1 + r));
}

/**
 * The full schedule. A rate change applies from the first instalment on or after its date; a
 * prepayment reduces the balance before the first instalment on or after its date. After either,
 * the EMI is worked out again for the months left (keep: tenure) or the months for the EMI (keep: emi).
 */
export function schedule(terms: LoanTerms, changes: RateChange[] = [], prepayments: Prepayment[] = []): Instalment[] {
    if (terms.type === 'flat') return flatSchedule(terms);
    if (terms.type === 'bullet') return bulletSchedule(terms);
    if (terms.type === 'interest_only') return interestOnlySchedule(terms, prepayments);
    const rateChanges = [...changes].sort((a, b) => a.from.localeCompare(b.from));
    const pending = [...prepayments].sort((a, b) => a.date.localeCompare(b.date));
    let rate = terms.yearlyRate;
    let emi = emiFor(terms.principal, rate, terms.months);
    let monthsLeft = terms.months;
    let balance = terms.principal;
    const rows: Instalment[] = [];
    for (let number = 1; balance > 0 && number <= 1200; number++) {
        const date = addMonths(terms.firstDue, number - 1);
        let prepaid = 0;
        while (pending.length > 0 && pending[0]!.date <= date) {
            const payment = pending.shift()!;
            const paid = Math.min(payment.paise, balance);
            balance -= paid;
            prepaid += paid;
            if (balance > 0) {
                // Keep the end date: a lower EMI. Keep the EMI: it finishes sooner (or later, after a top-up)
                if (payment.keep === 'tenure') emi = emiFor(balance, rate, monthsLeft);
                else monthsLeft = monthsFor(balance, rate, emi);
            }
        }
        while (rateChanges.length > 0 && rateChanges[0]!.from <= date) {
            const change = rateChanges.shift()!;
            rate = change.yearlyRate;
            if (change.keep === 'tenure') emi = emiFor(balance, rate, monthsLeft);
            else {
                monthsLeft = monthsFor(balance, rate, emi);
                // The EMI no longer covers the interest: the bank must raise it
                if (!Number.isFinite(monthsLeft)) {
                    monthsLeft = terms.months;
                    emi = emiFor(balance, rate, monthsLeft);
                }
            }
        }
        if (balance <= 0) {
            rows.push({ number, date, opening: prepaid, emi: 0, interest: 0, principal: 0, prepaid, closing: 0, yearlyRate: rate });
            break;
        }
        const interest = Math.round((balance * rate) / 12 / 100);
        const due = Math.min(emi, balance + interest);
        const principal = due - interest;
        rows.push({ number, date, opening: balance + prepaid, emi: due, interest, principal, prepaid, closing: balance - principal, yearlyRate: rate });
        balance -= principal;
        monthsLeft--;
    }
    return rows;
}

/** A flat-rate loan: interest on the whole principal for the whole term, paid in equal parts */
function flatSchedule(terms: LoanTerms): Instalment[] {
    const totalInterest = Math.round((terms.principal * terms.yearlyRate * terms.months) / 12 / 100);
    const rows: Instalment[] = [];
    let balance = terms.principal;
    for (let number = 1; number <= terms.months; number++) {
        const last = number === terms.months;
        const principal = last ? balance : Math.floor(terms.principal / terms.months);
        const interest = last ? totalInterest - Math.floor(totalInterest / terms.months) * (terms.months - 1) : Math.floor(totalInterest / terms.months);
        rows.push({
            number, date: addMonths(terms.firstDue, number - 1), opening: balance, emi: principal + interest, interest, principal, prepaid: 0,
            closing: balance - principal, yearlyRate: terms.yearlyRate,
        });
        balance -= principal;
    }
    return rows;
}

/** Bullet repayment: nothing until the end, then the principal and simple interest for the whole term */
function bulletSchedule(terms: LoanTerms): Instalment[] {
    const interest = Math.round((terms.principal * terms.yearlyRate * terms.months) / 12 / 100);
    return [{
        number: 1, date: addMonths(terms.firstDue, terms.months - 1), opening: terms.principal, emi: terms.principal + interest, interest,
        principal: terms.principal, prepaid: 0, closing: 0, yearlyRate: terms.yearlyRate,
    }];
}

/** Interest only: each month's interest on what is owed, and the principal with the last one */
function interestOnlySchedule(terms: LoanTerms, prepayments: Prepayment[]): Instalment[] {
    const pending = [...prepayments].sort((a, b) => a.date.localeCompare(b.date));
    const rows: Instalment[] = [];
    let balance = terms.principal;
    for (let number = 1; number <= terms.months && balance > 0; number++) {
        const date = addMonths(terms.firstDue, number - 1);
        let prepaid = 0;
        while (pending.length > 0 && pending[0]!.date <= date) {
            const paid = Math.min(pending.shift()!.paise, balance);
            balance -= paid;
            prepaid += paid;
        }
        const interest = Math.round((balance * terms.yearlyRate) / 12 / 100);
        const principal = number === terms.months ? balance : 0;
        rows.push({ number, date, opening: balance + prepaid, emi: interest + principal, interest, principal, prepaid, closing: balance - principal, yearlyRate: terms.yearlyRate });
        balance -= principal;
    }
    return rows;
}

/**
 * The true yearly cost of a loan: the rate that makes what was received (the principal less fees)
 * worth what is paid back. Flat rates and fees make it higher than the quoted rate. As % a year.
 */
export function effectiveYearlyRate(principal: number, fees: number, rows: Pick<Instalment, 'emi' | 'prepaid'>[]): number {
    // The loan received now, then each month's payment; the rate per month that balances them
    const monthly = irr([-(principal - fees), ...rows.map(row => row.emi + row.prepaid)]);
    return Math.round(((1 + monthly) ** 12 - 1) * 10000) / 100;
}

/** India's financial year of a date: 2026-05-10 is "2026-27" */
export function financialYearOf(date: string): string {
    const year = Number(date.slice(0, 4));
    const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
    return `${start}-${pad((start + 1) % 100)}`;
}

export interface PaidPart { date: string; principal: number; interest: number; fees?: number }

/** Principal, interest and fees paid in each financial year, oldest first (the interest certificate's figures) */
export function byFinancialYear(payments: PaidPart[]): { year: string; principal: number; interest: number; fees: number }[] {
    const years = new Map<string, { principal: number; interest: number; fees: number }>();
    for (const payment of payments) {
        const year = financialYearOf(payment.date);
        const total = years.get(year) ?? { principal: 0, interest: 0, fees: 0 };
        total.principal += payment.principal;
        total.interest += payment.interest;
        total.fees += payment.fees ?? 0;
        years.set(year, total);
    }
    return [...years].sort(([a], [b]) => a.localeCompare(b)).map(([year, total]) => ({ year, ...total }));
}

/** What closes the loan today: the balance, interest since the last EMI, and the foreclosure charge (% of the balance) */
export function foreclosureAmount(balance: number, yearlyRate: number, daysSinceLastEmi: number, chargePercent: number): { interest: number; charge: number; total: number } {
    const interest = Math.round((balance * yearlyRate * Math.max(daysSinceLastEmi, 0)) / 365 / 100);
    const charge = Math.round((balance * chargePercent) / 100);
    return { interest, charge, total: balance + interest + charge };
}

/** Interest saved by a prepayment: the schedule's interest without it, less with it */
export function interestSaved(terms: LoanTerms, changes: RateChange[], before: Prepayment[], added: Prepayment): number {
    const total = (rows: Instalment[]) => rows.reduce((sum, row) => sum + row.interest, 0);
    return total(schedule(terms, changes, before)) - total(schedule(terms, changes, [...before, added]));
}

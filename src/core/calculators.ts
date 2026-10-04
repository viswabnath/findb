/**
 * The website's free money calculators (/tools). Pure functions with no framework imports, so they
 * run in the browser and in unit tests alike. Rates are yearly percentages (8.5 means 8.5% a year).
 * Results are estimates for information, not offers or advice; each tool page says so.
 */

const round2 = (value: number) => Math.round(value * 100) / 100;

/* ---------- EMI ---------- */

export interface EmiYear {
    year: number;
    principalPaid: number;
    interestPaid: number;
    balance: number;
}

export interface EmiResult {
    emi: number;
    totalInterest: number;
    totalPaid: number;
    years: EmiYear[];
}

/** The monthly instalment for a loan, and how each year splits into principal and interest */
export function emi(principal: number, annualRate: number, months: number): EmiResult {
    const monthlyRate = annualRate / 12 / 100;
    const instalment = monthlyRate === 0
        ? principal / months
        : (principal * monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1);

    const years: EmiYear[] = [];
    let balance = principal;
    for (let month = 1; month <= months; month++) {
        const interest = balance * monthlyRate;
        const principalPart = Math.min(instalment - interest, balance);
        balance -= principalPart;
        const yearIndex = Math.ceil(month / 12) - 1;
        years[yearIndex] ??= { year: yearIndex + 1, principalPaid: 0, interestPaid: 0, balance: 0 };
        years[yearIndex].principalPaid += principalPart;
        years[yearIndex].interestPaid += interest;
        years[yearIndex].balance = Math.max(balance, 0);
    }

    const totalPaid = instalment * months;
    return {
        emi: round2(instalment),
        totalInterest: round2(totalPaid - principal),
        totalPaid: round2(totalPaid),
        years: years.map(year => ({
            year: year.year,
            principalPaid: round2(year.principalPaid),
            interestPaid: round2(year.interestPaid),
            balance: round2(year.balance),
        })),
    };
}

/* ---------- Interest per ₹100 ---------- */

/**
 * Lenders in India often quote interest as rupees per ₹100 a month: "₹1 per hundred" means ₹1 of
 * interest on every ₹100 each month, which is 12% a year. These convert between that and a
 * yearly percentage.
 */
export const perHundredMonthly = (annualRate: number) => annualRate / 12;
export const annualFromPerHundred = (perHundredMonthly: number) => perHundredMonthly * 12;

/** Interest (or growth) on every ₹100 put in or borrowed, over the whole period */
export const interestPerHundredBorrowed = (totalInterest: number, principal: number) =>
    principal > 0 ? round2((totalInterest / principal) * 100) : 0;

/* ---------- Fixed and recurring deposits ---------- */

export interface DepositResult {
    invested: number;
    interest: number;
    maturity: number;
}

/** A fixed deposit, compounded quarterly as most Indian banks do */
export function fixedDeposit(principal: number, annualRate: number, months: number, timesPerYear = 4): DepositResult {
    const maturity = principal * (1 + annualRate / 100 / timesPerYear) ** (timesPerYear * (months / 12));
    return { invested: round2(principal), interest: round2(maturity - principal), maturity: round2(maturity) };
}

/**
 * A recurring deposit: one instalment at the start of every month, each compounded quarterly
 * for the months it stays deposited (the method Indian banks and the post office use).
 */
export function recurringDeposit(monthly: number, annualRate: number, months: number): DepositResult {
    const quarterly = annualRate / 100 / 4;
    let maturity = 0;
    for (let monthsDeposited = 1; monthsDeposited <= months; monthsDeposited++) {
        maturity += monthly * (1 + quarterly) ** (monthsDeposited / 3);
    }
    const invested = monthly * months;
    return { invested: round2(invested), interest: round2(maturity - invested), maturity: round2(maturity) };
}

/* ---------- SIP ---------- */

export interface SipResult {
    invested: number;
    gains: number;
    value: number;
}

/** A monthly SIP at an assumed yearly return, invested at the start of each month */
export function sip(monthly: number, annualReturn: number, years: number): SipResult {
    const months = Math.round(years * 12);
    const rate = annualReturn / 12 / 100;
    const value = rate === 0 ? monthly * months : monthly * (((1 + rate) ** months - 1) / rate) * (1 + rate);
    const invested = monthly * months;
    return { invested: round2(invested), gains: round2(value - invested), value: round2(value) };
}

/* ---------- Gold ---------- */

export type Karat = 24 | 22 | 18 | 14;

/** The value of gold jewellery or coins from its weight, purity and today's 24 karat rate per gram */
export function goldValue(grams: number, karat: Karat, rate24PerGram: number) {
    const purity = karat / 24;
    const fineGrams = grams * purity;
    return { purity: round2(purity * 100), fineGrams: round2(fineGrams), value: round2(fineGrams * rate24PerGram) };
}

/* ---------- Inflation ---------- */

/** What inflation does to money: the future cost of today's spending, and today's value of future money */
export function inflation(amount: number, annualInflation: number, years: number) {
    const factor = (1 + annualInflation / 100) ** years;
    return { futureCost: round2(amount * factor), todaysValue: round2(amount / factor) };
}

/* ---------- Which loan first ---------- */

export interface LoanInput {
    name: string;
    balance: number;
    annualRate: number;
    emi: number;
}

export interface PayoffResult {
    /** Loans in the order the extra payment goes to them (highest interest rate first) */
    order: string[];
    months: number;
    totalInterest: number;
    /** Each loan's month of closing */
    closedIn: Record<string, number>;
    /** False when the payments never clear the debt (an EMI below the interest it accrues) */
    clears: boolean;
}

const MAX_MONTHS = 600;

/**
 * Pays every loan's EMI each month, and puts `extra` (plus the EMIs of loans already closed) on the
 * loan with the highest interest rate: the "avalanche" order, which saves the most interest.
 */
export function payoff(loans: LoanInput[], extra: number): PayoffResult {
    const order = [...loans].sort((a, b) => b.annualRate - a.annualRate);
    const balances = new Map(order.map(loan => [loan.name, loan.balance]));
    const closedIn: Record<string, number> = {};
    let totalInterest = 0;
    let month = 0;

    while ([...balances.values()].some(balance => balance > 0.005) && month < MAX_MONTHS) {
        month++;
        let pool = extra;
        for (const loan of order) {
            const balance = balances.get(loan.name)!;
            if (balance <= 0.005) {
                pool += loan.emi;
                continue;
            }
            const interest = balance * (loan.annualRate / 12 / 100);
            totalInterest += interest;
            const afterEmi = balance + interest - loan.emi;
            if (afterEmi <= 0) pool += -afterEmi;
            balances.set(loan.name, Math.max(afterEmi, 0));
        }
        for (const loan of order) {
            const balance = balances.get(loan.name)!;
            if (balance <= 0.005 || pool <= 0) continue;
            const paid = Math.min(balance, pool);
            balances.set(loan.name, balance - paid);
            pool -= paid;
        }
        for (const loan of order) {
            if (balances.get(loan.name)! <= 0.005 && closedIn[loan.name] === undefined) closedIn[loan.name] = month;
        }
    }

    const clears = [...balances.values()].every(balance => balance <= 0.005);
    return { order: order.map(loan => loan.name), months: month, totalInterest: round2(totalInterest), closedIn, clears };
}

/* ---------- Chit fund ---------- */

export interface ChitInput {
    /** The chit's total value, for example 5,00,000 */
    chitValue: number;
    /** Members, which is also the number of months */
    months: number;
    /** The organiser's commission, a percentage of the chit value taken each month (often 5) */
    commissionPct: number;
    /** The month you take the prize (1 = first) */
    yourMonth: number;
    /** The discount you bid when you take it, as a percentage of the chit value */
    yourBidPct: number;
    /** The average discount bid in the other months */
    othersBidPct: number;
}

export interface ChitResult {
    contribution: number;
    totalPaid: number;
    prize: number;
    /** Prize minus everything paid: positive means you got back more than you put in */
    net: number;
    /** Yearly rate implied by the cash flows: a cost when you take the prize early, a return when late */
    yearlyRate: number;
    /** The same rate as rupees per ₹100 a month, the way chit members usually speak of it */
    perHundredMonthly: number;
    role: 'borrower' | 'saver';
}

/**
 * Cash flows of one member of a chit. Each month every member pays chitValue / months, less a
 * dividend: the winning bid's discount minus the organiser's commission, shared by all members.
 * The winner of a month receives the chit value minus their discount.
 */
export function chitFund(input: ChitInput): ChitResult {
    const { chitValue, months, commissionPct, yourMonth, yourBidPct, othersBidPct } = input;
    const contribution = chitValue / months;
    const flows: number[] = [];
    let totalPaid = 0;

    for (let month = 1; month <= months; month++) {
        const bidPct = month === yourMonth ? yourBidPct : othersBidPct;
        const dividend = Math.max(0, bidPct - commissionPct) / 100 * chitValue / months;
        const pay = contribution - dividend;
        totalPaid += pay;
        flows.push(-pay + (month === yourMonth ? chitValue * (1 - yourBidPct / 100) : 0));
    }

    const prize = chitValue * (1 - yourBidPct / 100);
    const monthlyRate = irr(flows);
    const yearlyRate = (1 + monthlyRate) ** 12 - 1;
    const paidBefore = flows.slice(0, yourMonth - 1).reduce((sum, flow) => sum - flow, 0);
    return {
        contribution: round2(contribution),
        totalPaid: round2(totalPaid),
        prize: round2(prize),
        net: round2(prize - totalPaid),
        yearlyRate: round2(Math.abs(yearlyRate) * 100),
        perHundredMonthly: round2(Math.abs(monthlyRate) * 100),
        role: paidBefore < totalPaid / 2 ? 'borrower' : 'saver',
    };
}

/** Internal rate of return per period, found by scanning for a sign change and then bisecting */
export function irr(flows: number[]): number {
    const npv = (rate: number) => flows.reduce((sum, flow, index) => sum + flow / (1 + rate) ** (index + 1), 0);
    let low = -0.9;
    let previous = npv(low);
    for (let rate = -0.9 + 0.005; rate <= 1; rate += 0.005) {
        const value = npv(rate);
        if (previous === 0) return low;
        if (Math.sign(value) !== Math.sign(previous)) {
            let high = rate;
            for (let step = 0; step < 100; step++) {
                const mid = (low + high) / 2;
                if (Math.sign(npv(mid)) === Math.sign(npv(low))) low = mid; else high = mid;
            }
            return (low + high) / 2;
        }
        low = rate;
        previous = value;
    }
    return 0;
}

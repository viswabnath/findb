/**
 * Interest in both forms (v2 plan, "Interest in both forms"): every rate is entered and shown as
 * % a year and as ₹ per ₹100 a month, the way many Indians quote it (₹1 per ₹100 a month is 12% a
 * year). Rates are decimal text with up to three places, never floating-point sums.
 */

export type RateUnit = 'year' | 'per100month';

/** Text to thousandths of a percent, exactly: "2.5" is 2500 */
function thousandths(rate: string): number | null {
    const text = rate.trim();
    if (!/^\d{1,4}(\.\d{1,4})?$/.test(text)) return null;
    const [whole = '0', fraction = ''] = text.split('.');
    // Rounded half up at the third place
    const value = Number(whole) * 1000 + Number((fraction + '000').slice(0, 3)) + (Number((fraction + '0000').charAt(3)) >= 5 ? 1 : 0);
    return value;
}

const asText = (value: number) => `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, '0')}`.replace(/\.?0+$/, '') || '0';

/** A rate in either unit as % a year (text, up to three decimals); null if it is not a rate from 0 to 100% a year */
export function yearlyRate(rate: string, unit: RateUnit): string | null {
    const value = thousandths(rate);
    if (value === null) return null;
    const yearly = unit === 'year' ? value : value * 12;
    return yearly <= 100_000 ? asText(yearly) : null;
}

/** % a year as ₹ per ₹100 a month: 24 is "2", 18 is "1.5", 13 is "1.083" */
export function perHundredMonthly(yearlyPercent: string): string {
    const value = thousandths(yearlyPercent) ?? 0;
    return asText(Math.round(value / 12));
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Simple interest in paise on an amount for some days at a yearly rate (365-day year), rounded */
export function simpleInterest(paise: number, yearlyPercent: string, days: number): number {
    const rate = thousandths(yearlyPercent) ?? 0;
    if (paise <= 0 || days <= 0 || rate === 0) return 0;
    return Math.round((paise * rate * days) / (100 * 1000 * 365));
}

export interface Repayment { date: string; principalPaise: number; interestPaise: number }

export interface PersonLoanState {
    outstanding: number;
    principalRepaid: number;
    interestPaid: number;
    /** Simple interest built up on what was outstanding, day by day, less what was paid; never below zero */
    interestDue: number;
    status: 'open' | 'overdue' | 'settled';
}

/**
 * Where money lent to or borrowed from a person stands on a date: what is still owed, what was paid
 * back, and the simple interest due (none when interest-free). Overdue once the due date has passed
 * with something still owed.
 */
export function personLoanState(principal: number, yearlyPercent: string | null, startedOn: string, dueOn: string | null,
    repayments: Repayment[], today: string, closed = false): PersonLoanState {
    const sorted = [...repayments].sort((a, b) => a.date.localeCompare(b.date));
    let outstanding = principal;
    let accrued = 0;
    let since = startedOn;
    let principalRepaid = 0;
    let interestPaid = 0;
    for (const payment of sorted) {
        if (yearlyPercent) accrued += simpleInterest(outstanding, yearlyPercent, day(payment.date) - day(since));
        since = payment.date > since ? payment.date : since;
        outstanding -= payment.principalPaise;
        principalRepaid += payment.principalPaise;
        interestPaid += payment.interestPaise;
    }
    if (yearlyPercent && today > since) accrued += simpleInterest(outstanding, yearlyPercent, day(today) - day(since));
    outstanding = Math.max(outstanding, 0);
    const interestDue = closed ? 0 : Math.max(accrued - interestPaid, 0);
    const status = closed || (outstanding === 0 && interestDue === 0) ? 'settled' : dueOn && dueOn < today ? 'overdue' : 'open';
    return { outstanding, principalRepaid, interestPaid, interestDue, status };
}

/** How a repayment splits: interest due first, the rest towards what is owed (and no more than that) */
export function splitRepayment(amount: number, state: Pick<PersonLoanState, 'outstanding' | 'interestDue'>): { principalPaise: number; interestPaise: number; extra: number } {
    const interestPaise = Math.min(amount, state.interestDue);
    const principalPaise = Math.min(amount - interestPaise, state.outstanding);
    return { principalPaise, interestPaise, extra: amount - interestPaise - principalPaise };
}

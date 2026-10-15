/**
 * Chit funds (v2 plan, Phase 3). Each month every member pays a contribution; the month's chit
 * goes to the member who bids the biggest discount (or by draw). The discount, less the
 * organiser's commission (usually 5% of the chit value), is shared among all members as a
 * dividend, so what is actually due each month is the contribution less the dividend. The winner
 * receives the chit value less their discount and any other deductions.
 *
 * Amounts are whole paise; percentages are numbers (5 is 5%).
 */
import { irr } from './calculators';

export interface ChitTerms {
    /** The chit value, for example 5,00,000 */
    value: number;
    members: number;
    months: number;
    /** Each member's monthly contribution (value / members for a standard chit) */
    contribution: number;
    commissionPercent: number;
}

export interface Auction {
    /** The month, from 1 */
    month: number;
    /** The winning bid: the discount the winner gives up */
    discount: number;
}

/** The organiser's commission on a chit: a percentage of the chit value */
export const commissionOf = (terms: ChitTerms) => Math.round((terms.value * terms.commissionPercent) / 100);

/** Each member's dividend in a month: the discount less the commission, shared equally (never below zero) */
export function dividendFor(terms: ChitTerms, discount: number): number {
    return Math.max(Math.floor((discount - commissionOf(terms)) / terms.members), 0);
}

/** What is actually due in a month: the contribution less that month's dividend */
export function amountDue(terms: ChitTerms, discount: number): number {
    return terms.contribution - dividendFor(terms, discount);
}

/** What the winner receives: the chit value less their discount and any other deductions */
export function prize(terms: ChitTerms, discount: number, deductions = 0): number {
    return Math.max(terms.value - discount - deductions, 0);
}

export interface ChitOutcome {
    /** Every month's payment, and the prize in the month won */
    paid: number;
    received: number;
    /** Positive: a return (saving); negative: a cost (borrowing) */
    gain: number;
    /** The yearly rate of that return or cost, % (as an RD or a loan would be compared) */
    yearlyRate: number;
    role: 'saver' | 'borrower';
}

/**
 * The true return or cost of a chit for one member: payments each month (contribution less
 * dividend), the net prize in the month they won. Early winners borrow; late winners save.
 * Months without an auction yet are assumed to have no dividend (the cautious case).
 */
export function chitOutcome(terms: ChitTerms, auctions: Auction[], wonMonth: number, deductions = 0): ChitOutcome {
    const byMonth = new Map(auctions.map(auction => [auction.month, auction.discount]));
    const flows: number[] = [];
    let paid = 0;
    let received = 0;
    for (let month = 1; month <= terms.months; month++) {
        const due = amountDue(terms, byMonth.get(month) ?? commissionOf(terms));
        paid += due;
        let flow = -due;
        if (month === wonMonth) {
            const net = prize(terms, byMonth.get(month) ?? 0, deductions);
            received += net;
            flow += net;
        }
        flows.push(flow);
    }
    const monthly = irr(flows);
    // A positive monthly rate here is what the member earns when they save (pay first, receive later)
    const role = wonMonth > terms.months / 2 ? 'saver' : 'borrower';
    const yearlyRate = Math.round(((1 + Math.abs(monthly)) ** 12 - 1) * 10000) / 100;
    return { paid, received, gain: received - paid, yearlyRate, role };
}

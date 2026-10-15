/**
 * Shared expenses in a group (v2 plan, Phase 3: trips and flatmates). Pure arithmetic on whole
 * paise: how one cost splits among the people sharing it, what each member of a group is owed or
 * owes after every cost and settlement, and the fewest payments that settle everyone.
 *
 * Members are named by a key: "you" for the user, "p<id>" for a person in their list.
 */

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export interface SplitPart {
    member: string;
    /** exact: paise; percent: hundredths of a percent (25% is 2500); shares: a whole number; equal: unused */
    value?: number;
}

export type SplitProblem = 'noMembers' | 'exactTotal' | 'percentTotal' | 'badShares' | 'badValue';

/**
 * Each member's share of a total. Rounding never loses or invents a paisa: what is left after
 * rounding goes, a paisa at a time, to the members listed first (equal) or with the largest
 * remainders (percent, shares).
 */
export function splitAmount(total: number, method: SplitMethod, parts: SplitPart[]): Map<string, number> | SplitProblem {
    if (parts.length === 0 || new Set(parts.map(part => part.member)).size !== parts.length) return 'noMembers';
    const shares = new Map<string, number>();
    if (method === 'equal') {
        const each = Math.floor(total / parts.length);
        let left = total - each * parts.length;
        for (const part of parts) {
            shares.set(part.member, each + (left > 0 ? 1 : 0));
            left--;
        }
        return shares;
    }
    if (parts.some(part => !Number.isInteger(part.value) || (part.value ?? -1) < 0)) return 'badValue';
    if (method === 'exact') {
        if (parts.reduce((sum, part) => sum + part.value!, 0) !== total) return 'exactTotal';
        for (const part of parts) shares.set(part.member, part.value!);
        return shares;
    }
    const weights = parts.map(part => part.value!);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    if (method === 'percent' && weightTotal !== 10_000) return 'percentTotal';
    if (method === 'shares' && weightTotal <= 0) return 'badShares';
    const raw = parts.map((part, index) => ({ member: part.member, exact: (total * weights[index]!) / weightTotal, index }));
    let assigned = 0;
    for (const item of raw) {
        shares.set(item.member, Math.floor(item.exact));
        assigned += Math.floor(item.exact);
    }
    const byRemainder = [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.index - b.index);
    for (let left = total - assigned, i = 0; left > 0; left--, i++) {
        const item = byRemainder[i % byRemainder.length]!;
        shares.set(item.member, shares.get(item.member)! + 1);
    }
    return shares;
}

export interface SharedCost {
    /** Who paid the whole cost */
    paidBy: string;
    total: number;
    /** Who shares it, and how much each; a treat has only the payer */
    shares: Map<string, number> | Record<string, number>;
}

export interface Settlement { from: string; to: string; paise: number }

/** Each member's position: positive is owed to them, negative is what they owe */
export function groupBalances(costs: SharedCost[], settlements: Settlement[]): Map<string, number> {
    const net = new Map<string, number>();
    const add = (member: string, paise: number) => net.set(member, (net.get(member) ?? 0) + paise);
    for (const cost of costs) {
        add(cost.paidBy, cost.total);
        const shares = cost.shares instanceof Map ? cost.shares : new Map(Object.entries(cost.shares));
        for (const [member, paise] of shares) add(member, -paise);
    }
    for (const payment of settlements) {
        add(payment.from, payment.paise);
        add(payment.to, -payment.paise);
    }
    return net;
}

/**
 * The fewest payments (or near it) that settle a group: the one who owes most pays the one owed
 * most, again and again. Members are taken in a fixed order, so the same balances give the same plan.
 */
export function simplifyDebts(net: Map<string, number>): Settlement[] {
    const owes = [...net].filter(([, paise]) => paise < 0).map(([member, paise]) => ({ member, paise: -paise }));
    const owed = [...net].filter(([, paise]) => paise > 0).map(([member, paise]) => ({ member, paise }));
    const order = (a: { member: string; paise: number }, b: { member: string; paise: number }) => b.paise - a.paise || a.member.localeCompare(b.member);
    const plan: Settlement[] = [];
    while (owes.length > 0 && owed.length > 0) {
        owes.sort(order);
        owed.sort(order);
        const debtor = owes[0]!;
        const creditor = owed[0]!;
        const paise = Math.min(debtor.paise, creditor.paise);
        plan.push({ from: debtor.member, to: creditor.member, paise });
        debtor.paise -= paise;
        creditor.paise -= paise;
        if (debtor.paise === 0) owes.shift();
        if (creditor.paise === 0) owed.shift();
    }
    return plan;
}

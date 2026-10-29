/**
 * Card rewards (v2 plan, Phase 4): the reward points left on a card, which of them expire soon,
 * and the effective reward rate of a card (what it gave back for what was spent on it).
 * Points are used earliest-expiring first, as banks do. Dates are YYYY-MM-DD; amounts are paise.
 */

/** Points expiring within this many days are a warning */
export const POINTS_WARNING_DAYS = 60;
/** ...and within this many, the next step */
export const POINTS_URGENT_DAYS = 30;
/** The card comparison looks back this many months */
export const COMPARE_MONTHS = 12;

export interface PointsMove {
    kind: 'earned' | 'redeemed' | 'expired';
    date: string;
    points: number;
    expiresOn: string | null;
}

export interface PointsState {
    /** Points that can still be used */
    balance: number;
    /** Batches still to use, earliest expiry first, with days left */
    expiring: { expiresOn: string; points: number; daysLeft: number }[];
    /** Points whose expiry date has passed without being used or recorded as expired */
    lapsed: number;
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function pointsState(moves: PointsMove[], today: string): PointsState {
    // Earned batches, earliest expiry first (no expiry last), then by date
    const batches = moves.filter(move => move.kind === 'earned')
        .map(move => ({ expiresOn: move.expiresOn, date: move.date, left: move.points }))
        .sort((a, b) => (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.date.localeCompare(b.date));
    let used = moves.filter(move => move.kind !== 'earned').reduce((sum, move) => sum + move.points, 0);
    for (const batch of batches) {
        const take = Math.min(batch.left, used);
        batch.left -= take;
        used -= take;
    }
    const open = batches.filter(batch => batch.left > 0);
    const lapsed = open.filter(batch => batch.expiresOn !== null && batch.expiresOn < today).reduce((sum, batch) => sum + batch.left, 0);
    const live = open.filter(batch => batch.expiresOn === null || batch.expiresOn >= today);
    // More used than earned (points earned before FinDB): the balance cannot go below zero
    const balance = Math.max(live.reduce((sum, batch) => sum + batch.left, 0) - used, 0);
    const byDate = new Map<string, number>();
    for (const batch of live) if (batch.expiresOn) byDate.set(batch.expiresOn, (byDate.get(batch.expiresOn) ?? 0) + batch.left);
    return {
        balance: round2(balance),
        expiring: [...byDate].map(([expiresOn, points]) => ({ expiresOn, points: round2(points), daysLeft: day(expiresOn) - day(today) })),
        lapsed: round2(lapsed),
    };
}

/** What points are worth at a value per point (₹, e.g. 0.25), in paise */
export function pointsValue(points: number, rupeesPerPoint: number | null): number | null {
    if (rupeesPerPoint === null) return null;
    return Math.round(points * rupeesPerPoint * 100);
}

/** The reward given back as a % of the spending, two decimals; null with no spending */
export function rewardRate(rewardPaise: number, spendPaise: number): number | null {
    if (spendPaise <= 0) return null;
    return Math.round((rewardPaise * 10000) / spendPaise) / 100;
}

/**
 * Unit tests for src/core/rewards.ts: points left and expiring, their value, the reward rate
 */
import { pointsState, pointsValue, rewardRate, type PointsMove } from '../../src/core/rewards';

const TODAY = '2026-10-29';

test('points are used earliest-expiring first; what is left expires by batch', () => {
    const moves: PointsMove[] = [
        { kind: 'earned', date: '2026-01-10', points: 1000, expiresOn: '2026-12-31' },
        { kind: 'earned', date: '2026-06-10', points: 500, expiresOn: '2027-06-30' },
        { kind: 'earned', date: '2026-08-10', points: 200, expiresOn: null },
        { kind: 'redeemed', date: '2026-09-01', points: 700, expiresOn: null },
    ];
    expect(pointsState(moves, TODAY)).toEqual({
        balance: 1000,
        expiring: [{ expiresOn: '2026-12-31', points: 300, daysLeft: 63 }, { expiresOn: '2027-06-30', points: 500, daysLeft: 244 }],
        lapsed: 0,
    });
});

test('points past their expiry and not used have lapsed; recorded expiries use them up', () => {
    const moves: PointsMove[] = [
        { kind: 'earned', date: '2025-01-10', points: 400, expiresOn: '2026-10-01' },
        { kind: 'earned', date: '2026-02-10', points: 600, expiresOn: '2027-02-28' },
    ];
    expect(pointsState(moves, TODAY)).toMatchObject({ balance: 600, lapsed: 400 });
    expect(pointsState([...moves, { kind: 'expired', date: '2026-10-01', points: 400, expiresOn: null }], TODAY)).toMatchObject({ balance: 600, lapsed: 0 });
});

test('more used than recorded as earned never goes below zero', () => {
    expect(pointsState([{ kind: 'redeemed', date: '2026-01-01', points: 50, expiresOn: null }], TODAY)).toEqual({ balance: 0, expiring: [], lapsed: 0 });
});

test('the value of points and the reward rate', () => {
    expect(pointsValue(1000, 0.25)).toBe(25_000);
    expect(pointsValue(1000, null)).toBeNull();
    // Rs 1,500 back on Rs 1,00,000 spent
    expect(rewardRate(150_000, 10_000_000)).toBe(1.5);
    expect(rewardRate(100, 0)).toBeNull();
});

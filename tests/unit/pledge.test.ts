/**
 * Unit tests for src/core/pledge.ts and the gold loan repayment styles in src/core/loans.ts
 */
import { goldValuePaise, marginState } from '../../src/core/pledge';
import { effectiveYearlyRate, schedule } from '../../src/core/loans';

describe('pledged gold', () => {
    test('value from weight, purity and the 24 karat rate', () => {
        // 50 g of 22 karat at ₹7,200 a gram of 24 karat: 45.83 fine grams
        expect(goldValuePaise(50, 22, 720_000)).toBe(33_000_000);
    });

    test('loan-to-value and the margin risk', () => {
        expect(marginState(18_000_000, 33_000_000)).toMatchObject({ ltv: 54.55, risk: 'ok' });
        expect(marginState(24_000_000, 33_000_000)).toMatchObject({ ltv: 72.73, risk: 'near' });
        expect(marginState(26_000_000, 33_000_000)).toMatchObject({ ltv: 78.79, risk: 'margin', headroom: 0 });
        expect(marginState(26_000_000, 33_000_000, 85).risk).toBe('ok');
        // How far the gold can fall before the limit: 33,00,000 less 1,80,000 / 0.75
        expect(marginState(18_000_000, 33_000_000).headroom).toBe(9_000_000);
    });
});

describe('gold loan repayment', () => {
    const base = { principal: 20_000_000, yearlyRate: 12, months: 12, firstDue: '2026-11-15' };

    test('bullet: one payment at the end, with simple interest for the year', () => {
        expect(schedule({ ...base, type: 'bullet' })).toEqual([expect.objectContaining({ date: '2027-10-15', interest: 2_400_000, emi: 22_400_000, closing: 0 })]);
    });

    test('interest only: a month\'s interest each month, the principal with the last', () => {
        const rows = schedule({ ...base, type: 'interest_only' });
        expect(rows).toHaveLength(12);
        expect(rows[0]).toMatchObject({ emi: 200_000, principal: 0 });
        expect(rows[11]).toMatchObject({ emi: 20_200_000, principal: 20_000_000, closing: 0 });
        expect(effectiveYearlyRate(base.principal, 0, rows)).toBeCloseTo(12.68, 1);
    });
});

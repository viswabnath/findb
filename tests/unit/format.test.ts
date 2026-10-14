/**
 * Unit tests for lib/format.ts
 */
import { formatRupees, signedRupees } from '../../lib/format';

describe('formatRupees', () => {
    test.each<[string | number | null | undefined, string]>([
        ['500000', '₹5,00,000.00'],
        ['1234.5', '₹1,234.50'],
        [0, '₹0.00'],
        ['-250.75', '₹-250.75'],
        [12345678.9, '₹1,23,45,678.90'],
        [null, '₹0.00'],
        [undefined, '₹0.00'],
        ['not a number', '₹0.00'],
    ])('%p -> %s', (value, expected) => {
        expect(formatRupees(value)).toBe(expected);
    });
});

describe('signedRupees', () => {
    test('puts the direction in front of the rupee sign', () => {
        expect(signedRupees('-120.50')).toBe('-₹120.50');
        expect(signedRupees('500000')).toBe('+₹5,00,000.00');
    });
});

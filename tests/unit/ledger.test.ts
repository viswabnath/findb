/**
 * Unit tests for lib/ledger.ts: paise rounding and the balance check before an entry is written
 */
import { fromPaise, postEntry, toPaise } from '../../lib/ledger';

describe('toPaise', () => {
    test('turns rupees into whole paise without floating-point error', () => {
        expect(toPaise('1000.55')).toBe(100055);
        expect(toPaise(0.1 + 0.2)).toBe(30);
        expect(toPaise(1234.56)).toBe(123456);
        expect(toPaise('19.99')).toBe(1999);
        expect(toPaise('7')).toBe(700);
        expect(toPaise('.5')).toBe(50);
        expect(toPaise(0)).toBe(0);
    });

    test('rounds half away from zero at the third decimal, as DECIMAL(20,2) does', () => {
        expect(toPaise('100.005')).toBe(10001);
        expect(toPaise('100.004')).toBe(10000);
        expect(toPaise('-2.345')).toBe(-235);
        expect(toPaise('0.999')).toBe(100);
    });

    test('refuses what is not an amount', () => {
        expect(() => toPaise('abc')).toThrow('Not an amount');
        expect(() => toPaise('')).toThrow('Not an amount');
        expect(() => toPaise(undefined)).toThrow('Not an amount');
        expect(() => toPaise(Number.NaN)).toThrow('Not an amount');
    });

    test('reads tiny numbers written with an exponent, and refuses amounts too large for exact paise', () => {
        expect(toPaise(1e-7)).toBe(0);
        expect(toPaise(5e-3)).toBe(1);
        expect(() => toPaise(1e20)).toThrow('Amount too large');
    });
});

describe('fromPaise', () => {
    test('writes paise as rupees with two decimals, as Postgres returns DECIMAL(20,2)', () => {
        expect(fromPaise(123456)).toBe('1234.56');
        expect(fromPaise(5)).toBe('0.05');
        expect(fromPaise(0)).toBe('0.00');
        expect(fromPaise(-50)).toBe('-0.50');
        expect(fromPaise('-123400')).toBe('-1234.00');
    });

    test('round-trips with toPaise', () => {
        for (const amount of ['0.01', '19.99', '100000.10', '-7.05']) expect(fromPaise(toPaise(amount))).toBe(amount);
    });
});

describe('postEntry', () => {
    const fakeClient = () => {
        const calls: unknown[][] = [];
        return {
            calls,
            query: jest.fn(async (sql: string, params: unknown[]) => {
                calls.push([sql, params]);
                return { rows: [{ id: 7 }] };
            }),
        };
    };

    test('refuses lines that do not add up to zero, before writing anything', async () => {
        const client = fakeClient();
        await expect(postEntry(client as never, {
            userId: 1, description: 'Probe', type: 'adjustment', lines: [{ accountId: 1, paise: 100 }, { accountId: 2, paise: -99 }],
        })).rejects.toThrow('does not balance');
        expect(client.calls).toHaveLength(0);
    });

    test('leaves out zero lines, and records nothing when every line is zero', async () => {
        const client = fakeClient();
        expect(await postEntry(client as never, {
            userId: 1, description: 'Nothing', type: 'adjustment', lines: [{ accountId: 1, paise: 0 }, { accountId: 2, paise: 0 }],
        })).toBeNull();
        expect(client.calls).toHaveLength(0);

        expect(await postEntry(client as never, {
            userId: 1, description: 'Rent', type: 'expense', lines: [{ accountId: 1, paise: 500 }, { accountId: 2, paise: -500 }, { accountId: 3, paise: 0 }],
        })).toBe(7);
        // One entry and two lines
        expect(client.calls).toHaveLength(3);
    });
});

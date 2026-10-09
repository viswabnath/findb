/**
 * Unit tests for lib/categories.ts: the defaults and keyword suggestions
 */
import { CATEGORY_KEYWORDS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, suggestByKeyword, titleWords } from '../../lib/categories';

describe('default categories', () => {
    test('the plan\'s spending and income categories, with unique keys', () => {
        expect(EXPENSE_CATEGORIES.map(category => category.name)).toContain('Restaurants and food delivery');
        expect(EXPENSE_CATEGORIES).toHaveLength(18);
        expect(INCOME_CATEGORIES).toHaveLength(10);
        const keys = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map(category => category.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const key of keys) expect(key).toMatch(/^[a-z_]{1,40}$/);
    });

    test('every spending category is marked essential or not; rent and groceries are essential, restaurants are not', () => {
        for (const category of EXPENSE_CATEGORIES) expect(typeof category.essential).toBe('boolean');
        const essential = Object.fromEntries(EXPENSE_CATEGORIES.map(category => [category.key, category.essential]));
        expect([essential.rent, essential.groceries, essential.bills, essential.restaurants, essential.shopping]).toEqual([true, true, true, false, false]);
    });

    test('every keyword points at a default category', () => {
        const keys = new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map(category => category.key));
        for (const { key } of CATEGORY_KEYWORDS) expect(keys.has(key)).toBe(true);
    });
});

describe('suggestByKeyword', () => {
    test.each([
        ['Swiggy order', 'expense', 'restaurants'],
        ['HP Petrol pump', 'expense', 'fuel'],
        ['Uber to airport', 'expense', 'transport'],
        ['Netflix monthly', 'expense', 'subscriptions'],
        ['Electricity bill (BESCOM)', 'expense', 'bills'],
        ['Home loan EMI', 'expense', 'loan_interest'],
        ['October salary', 'income', 'salary'],
        ['Pluxee top-up', 'income', 'meal_benefit'],
        ['Savings interest', 'income', 'interest'],
        ['Amazon refund', 'income', 'refund'],
    ])('%s (%s) suggests %s', (title, kind, key) => {
        expect(suggestByKeyword(title, kind as 'income' | 'expense')).toBe(key);
    });

    test('whole words only, and only categories of the right kind', () => {
        expect(suggestByKeyword('Shopkeeper', 'expense')).toBeNull();
        expect(suggestByKeyword('Salary advance', 'expense')).toBeNull();
        expect(suggestByKeyword('Advance tax', 'expense')).toBe('taxes');
        expect(suggestByKeyword('Amazon order', 'income')).toBeNull();
        expect(suggestByKeyword('', 'expense')).toBeNull();
    });

    test('titleWords lowers case and drops punctuation', () => {
        expect(titleWords('Zomato: Biryani, x2!')).toEqual(['zomato', 'biryani', 'x2']);
    });
});

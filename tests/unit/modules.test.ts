import { MODULE_KEYS, modulesFromTracking, modulesProblem, PRESETS, suggestModule, trackingFromModules } from '@/lib/modules';

describe('module switches', () => {
    test('the former tracking choice maps to modules and back', () => {
        for (const option of ['income', 'expenses', 'both'] as const) {
            expect(trackingFromModules(modulesFromTracking(option))).toBe(option);
        }
        expect(modulesFromTracking(null)).toEqual(['income', 'spending', 'credit_cards']);
        expect(trackingFromModules(['spending', 'investments'])).toBe('expenses');
    });

    test('a choice needs income or spending, and known modules only', () => {
        expect(modulesProblem(['spending'])).toBeNull();
        expect(modulesProblem(['credit_cards', 'goals'])).toMatch(/income or spending/);
        expect(modulesProblem(['spending', 'crypto'])).toBe('Choose from the listed modules');
        expect(modulesProblem('spending')).toBe('Choose from the listed modules');
        for (const preset of PRESETS) expect(modulesProblem(preset.modules)).toBeNull();
        expect(PRESETS.find(preset => preset.key === 'everything')?.modules).toEqual(MODULE_KEYS);
    });

    test('a title suggests a switched-off module, by whole word, unless declined', () => {
        expect(suggestModule('Home loan EMI', ['spending'], [])?.key).toBe('debts');
        expect(suggestModule('Monthly SIP', ['spending'], [])?.key).toBe('investments');
        expect(suggestModule('LIC premium', ['spending'], [])?.key).toBe('insurance');
        expect(suggestModule('Home loan EMI', ['spending', 'debts'], [])).toBeNull();
        expect(suggestModule('Home loan EMI', ['spending'], ['debts'])).toBeNull();
        // Part of a word does not count
        expect(suggestModule('Sipping tea', ['spending'], [])).toBeNull();
        expect(suggestModule('Groceries', ['spending'], [])).toBeNull();
    });
});

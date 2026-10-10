import { t } from '@/lib/i18n';
import { en } from '@/messages/en';
import { parseTheme, themeCookie } from '@/lib/theme';

describe('message files', () => {
    test('a message is looked up by its dotted path', () => {
        expect(t('accounts.title')).toBe('Accounts');
        expect(t('nav.transactions')).toBe('Transactions');
    });

    test('{name} is filled in, and a count picks one or other', () => {
        expect(t('accounts.other.removeQuestion', { name: 'Paytm' })).toBe('Remove Paytm?');
        expect(t('accounts.banks.count', { count: 1 })).toBe('1 account');
        expect(t('accounts.banks.count', { count: 2 })).toBe('2 accounts');
        expect(t('accounts.banks.count', { count: 0 })).toBe('0 accounts');
    });

    test('an unknown path shows the path rather than nothing', () => {
        expect(t('accounts.nothing' as never)).toBe('accounts.nothing');
    });

    test('every message is plain text, with no emoji or markup', () => {
        const texts: string[] = [];
        const walk = (node: unknown) => {
            if (typeof node === 'string') texts.push(node);
            else if (node && typeof node === 'object') Object.values(node).forEach(walk);
        };
        walk(en);
        expect(texts.length).toBeGreaterThan(50);
        for (const text of texts) expect(text).not.toMatch(/<[a-z]|\p{Extended_Pictographic}/u);
    });
});

describe('theme', () => {
    test('only light and dark are kept; anything else follows the device', () => {
        expect(parseTheme('dark')).toBe('dark');
        expect(parseTheme('light')).toBe('light');
        expect(parseTheme('purple')).toBe('system');
        expect(parseTheme(undefined)).toBe('system');
    });

    test('the cookie keeps a choice for a year, and choosing the device setting removes it', () => {
        expect(themeCookie('dark', true)).toBe('findb_theme=dark; Path=/; SameSite=Lax; Secure; Max-Age=31536000');
        expect(themeCookie('system', false)).toBe('findb_theme=; Path=/; Max-Age=0; SameSite=Lax');
    });
});

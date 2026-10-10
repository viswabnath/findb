import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every word an app screen shows comes from messages/en.ts (v2 plan: ready for Indian languages).
 * This scans the app's components for words written straight into JSX: text between tags, and
 * labels, titles, placeholders and screen reader labels given as plain strings. The website
 * (components/site) has its own copy file, components/site/content.ts.
 */

const ROOT = join(__dirname, '..', '..', 'components');
const APP_FOLDERS = ['activity', 'app', 'auth', 'events', 'privacy', 'reconcile', 'settings', 'setup', 'summary', 'transactions', 'ui'];
const SHARED_FILES = ['Modal.tsx', 'Toast.tsx', 'HydrationGate.tsx'];

/** Not words a reader needs translated: example formats */
const ALLOWED = new Set(['ABCDE1234F', '0.00', '3.25', 'xxxxx-xxxxx']);

function files(): string[] {
    const found = SHARED_FILES.map(name => join(ROOT, name));
    for (const folder of APP_FOLDERS) {
        for (const name of readdirSync(join(ROOT, folder))) if (name.endsWith('.tsx')) found.push(join(ROOT, folder, name));
    }
    return found;
}

function problems(source: string): string[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found: string[] = [];
    // Text between JSX tags: >Some words<  (ignoring {expressions})
    for (const match of code.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) {
        const text = match[1]!.trim();
        // Code that looks like text between angle brackets: comparisons, generic types, object keys
        const looksLikeCode = /=>|\(|\)|;$|&&|\|\||^[,=]|:$/.test(text);
        if (text && !/^[\s&a-z;]*$/.test(text) && !ALLOWED.has(text) && !looksLikeCode) found.push(text);
    }
    // Attributes a reader sees or hears, given as plain strings
    for (const match of code.matchAll(/\b(label|title|placeholder|aria-label|help|step|doneLabel|alt)="([^"]*[A-Za-z][^"]*)"/g)) {
        if (!ALLOWED.has(match[2]!)) found.push(`${match[1]}="${match[2]}"`);
    }
    return found;
}

describe('the check itself', () => {
    test('finds words written into JSX, and leaves code and message lookups alone', () => {
        expect(problems('<p>Hello there</p><input placeholder="Your name" aria-label="Close" />')).toEqual(['Hello there', 'placeholder="Your name"', 'aria-label="Close"']);
        expect(problems("<p>{t('accounts.title')}</p><input placeholder={t('x')} />")).toEqual([]);
        expect(problems('const ok = a >= 8 && b <= 64; type R = Record<string, { a: number }>;')).toEqual([]);
    });
});

describe('app screens take their words from the message files', () => {
    test.each(files().map(file => [file.slice(ROOT.length + 1), file]))('%s', (_name, file) => {
        expect(problems(readFileSync(file, 'utf8'))).toEqual([]);
    });
});

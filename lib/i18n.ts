import { en } from '@/messages/en';

/**
 * Every word on a screen comes from a message file (v2 plan: ready for Indian languages), never
 * from the component. messages/en.ts is the English text; a translation is another file of the
 * same shape. Amounts and dates are formatted separately (lib/format.ts), in Indian style.
 *
 *   t('accounts.title')                      "Accounts"
 *   t('accounts.banks.count', { count: 2 })  "2 accounts"  (a message with one/other forms)
 *   t('accounts.deleteBank', { name })       "{name}" in the text is replaced
 */

export type Plural = { one: string; other: string };
type Leaf = string | Plural;
type Tree = { readonly [key: string]: Leaf | Tree };

/** "accounts.title" and every other dotted path to a message */
type Paths<T, Prefix extends string = ''> = {
    [K in keyof T & string]: T[K] extends Leaf ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>
}[keyof T & string];

export type MessageKey = Paths<typeof en>;
export type Vars = Record<string, string | number>;

const plurals = new Intl.PluralRules('en-IN');

function lookup(tree: Tree, key: string): Leaf | undefined {
    let node: Leaf | Tree | undefined = tree;
    for (const part of key.split('.')) {
        if (node === undefined || typeof node === 'string' || 'one' in node && typeof node.one === 'string') return undefined;
        node = (node as Tree)[part];
    }
    return node as Leaf | undefined;
}

export function t(key: MessageKey, vars?: Vars): string {
    const message = lookup(en, key);
    if (message === undefined) return key;
    const text = typeof message === 'string'
        ? message
        : plurals.select(Number(vars?.count ?? 0)) === 'one' ? message.one : message.other;
    return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

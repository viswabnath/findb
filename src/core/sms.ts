/**
 * Reading a bank SMS shared into FinDB (v2 Phase 5, share to FinDB): the amount, whether money went
 * out or came in, the date, who it was paid to or from, and the account's last digits, for the user
 * to check in quick add. Rule-based, for the common formats Indian banks send; anything it cannot
 * find is left for the user. Runs on the phone; the message is never sent to the server.
 */

export interface SmsEntry {
    /** Rupees as typed in a form: "450.00" */
    amount: string | null;
    kind: 'expense' | 'income' | null;
    /** YYYY-MM-DD */
    date: string | null;
    merchant: string | null;
    /** The last digits of the account or card, as the SMS shows them */
    last4: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The first amount that is not a balance or limit the bank adds at the end */
function amountOf(text: string): string | null {
    const pattern = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const before = text.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
        if (/(avl|avail|available|bal|balance|limit|lmt)[\s.:a-z]*$/.test(before)) continue;
        const value = Number(match[1]!.replace(/,/g, ''));
        if (value > 0) return value.toFixed(2);
    }
    return null;
}

function kindOf(text: string): SmsEntry['kind'] {
    const lower = text.toLowerCase();
    const out = lower.search(/\b(debited|spent|sent|paid|withdrawn|purchase|dr\b)/);
    const into = lower.search(/\b(credited|received|deposited|refund(ed)?|cr\b)/);
    if (out === -1 && into === -1) return null;
    if (out === -1) return 'income';
    if (into === -1) return 'expense';
    return out < into ? 'expense' : 'income';
}

function dateOf(text: string): string | null {
    const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const named = /\b(\d{1,2})[-\s/]([a-z]{3})[a-z]*[-\s/,]*(\d{2,4})\b/i.exec(text);
    if (named && MONTHS.includes(named[2]!.toLowerCase())) {
        const year = named[3]!.length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
        return `${year}-${pad(MONTHS.indexOf(named[2]!.toLowerCase()) + 1)}-${pad(Number(named[1]))}`;
    }
    const numeric = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(text);
    if (numeric) {
        const day = Number(numeric[1]);
        const month = Number(numeric[2]);
        const year = numeric[3]!.length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return `${year}-${pad(month)}-${pad(day)}`;
    }
    return null;
}

function tidy(name: string): string | null {
    const cleaned = name.replace(/@[a-z0-9.]+/gi, '').replace(/[^A-Za-z0-9&.' -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 2 || /^(a\/?c|acct|account|your|the|upi|ref)$/i.test(cleaned)) return null;
    return cleaned.slice(0, 60);
}

function merchantOf(text: string, kind: SmsEntry['kind']): string | null {
    // "...; NETFLIX credited." (ICICI style): the payee named before "credited"
    const iciciStyle = /;\s*([A-Za-z0-9 &.'-]{2,40}?)\s+credited/i.exec(text);
    if (kind === 'expense' && iciciStyle) return tidy(iciciStyle[1]!);
    const words = kind === 'income' ? ['from', 'by'] : ['at', 'to', 'towards', 'trf to', 'info'];
    for (const word of words) {
        const match = new RegExp(`\\b${word}[:\\s]+(?:vpa\\s+)?([A-Za-z0-9@._&' -]{2,50}?)(?=\\s+(?:on|ref|via|upi|avl|txn|is|has|for|dated)\\b|[.;,(]|$)`, 'i').exec(text);
        if (!match) continue;
        // "from A/c XX1234" is the user's own account, not who paid
        if (/^(a\/?c|acct|account|your|hdfc bank a\/?c|card)\b/i.test(match[1]!.trim())) continue;
        const name = tidy(match[1]!);
        if (name) return name;
    }
    return null;
}

function last4Of(text: string): string | null {
    const match = /(?:a\/?c|acct|account|card)(?:\s*no\.?)?\s*(?:ending\s*)?[x*.]*\s*(\d{3,4})\b/i.exec(text);
    return match ? match[1]! : null;
}

export function readSms(text: string): SmsEntry {
    const kind = kindOf(text);
    return { amount: amountOf(text), kind, date: dateOf(text), merchant: merchantOf(text, kind), last4: last4Of(text) };
}

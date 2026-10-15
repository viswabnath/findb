/**
 * The amount, date and merchant from the text of a receipt photo or a UPI payment screenshot
 * (v2 plan, Phase 2: reading receipts). The text comes from OCR in the browser, so it has OCR's
 * mistakes: the rupee sign read as "%", "X" or "z", stray spaces, and numbers that are references
 * or phone numbers rather than amounts. Every value is a suggestion the user checks before saving.
 *
 * - UPI screenshots (Google Pay, PhonePe, Paytm, BHIM): the amount on a line of its own, the payee
 *   after "Paid to" or "To", the date of the payment;
 * - receipts: the grand total, net amount or amount paid (never the subtotal, tax or item count),
 *   the shop's name from the first lines, the date printed on it.
 *
 * OCR has no rupee sign: it reads "₹" as "¥", "%", "X" or "z", or drops it, and in a UPI app's large
 * amount ("₹450", no space) it often reads it as a "3" or a "2" ("3450"), as confidently as the real
 * digits. Such an amount is read without that first digit, and the number as read is returned as
 * `readAs` so the screen can offer it.
 */
import { parseDate, softenCapitals } from './statement';

export interface ReceiptReading {
    kind: 'upi' | 'receipt';
    /** Rupees with two decimals, as the API takes amounts */
    amount: string | null;
    /** YYYY-MM-DD */
    date: string | null;
    merchant: string | null;
    /** When the first digit was taken for a misread rupee sign: the amount as OCR read it */
    readAs: string | null;
}

/** The most a receipt is read as (above it, the number is surely a reference) */
const MAX_PAISE = 1_00_00_000_00;

const UPI_WORDS = /\b(upi|google pay|gpay|phonepe|phone pe|paytm|bhim|paid to|payment successful|transaction successful|upi transaction id|upi ref)\b/i;

/** An amount in a piece of text: Indian or plain grouping, an optional rupee mark (or what OCR makes of it) */
const AMOUNT = /(?:(₹|¥|rs\.?|inr|%|x|z)\s?)?(\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)(?![\d,])/gi;

interface Found { paise: number; marked: boolean; decimals: boolean }

function amountsIn(line: string): Found[] {
    const found: Found[] = [];
    for (const match of line.matchAll(AMOUNT)) {
        const mark = match[1];
        const digits = match[2]!;
        // A letter just before the number is part of a word or code ("GSTIN29AB...", "No1234")
        const before = line.charAt((match.index ?? 0) - 1);
        if (!mark && /[a-z]/i.test(before)) continue;
        // A long run of digits without a decimal point or grouping is a reference, phone or card number
        if (!digits.includes('.') && !digits.includes(',') && digits.length >= 6) continue;
        const [whole = '0', fraction = ''] = digits.replace(/,/g, '').split('.');
        const paise = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
        if (paise <= 0 || paise > MAX_PAISE) continue;
        // "x" or "z" before a number counts as a rupee mark only when it stands apart ("X 450", "z450" at the start)
        const marked = Boolean(mark) && !(/^[xz%]$/i.test(mark!) && /[a-z0-9]/i.test(line.charAt((match.index ?? 0) - 1)));
        found.push({ paise, marked, decimals: digits.includes('.') });
    }
    return found;
}

const text = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

/** Lines that name the total, best first; lines that only look like it are left out */
const TOTAL_WORDS: RegExp[] = [
    /grand\s*total/i,
    /net\s*(amount|payable|total|amt)/i,
    /(amount|amt)\s*(paid|payable|due)|total\s*(payable|due)|to\s*pay|bill\s*amount/i,
    /\btotal\b/i,
];
const NOT_TOTAL = /sub\s*-?\s*total|total\s*(qty|quantity|items?|tax|gst|savings?|discount)|\bsaved?\b|\btax(able)?\b|cgst|sgst|igst|round\s*off|change|tendered/i;

function receiptAmount(lines: string[]): number | null {
    for (const words of TOTAL_WORDS) {
        // The last such line: totals come at the end, after any earlier lines that mention them
        for (let index = lines.length - 1; index >= 0; index--) {
            const line = lines[index]!;
            if (!words.test(line) || NOT_TOTAL.test(line)) continue;
            const here = amountsIn(line).filter(found => found.decimals || found.marked || found.paise >= 100);
            if (here.length > 0) return here[here.length - 1]!.paise;
            // The amount may be on the next line, under its label
            const next = amountsIn(lines[index + 1] ?? '');
            if (next.length > 0) return next[next.length - 1]!.paise;
        }
    }
    // No total named: the largest amount with a rupee mark or decimals
    const all = lines.flatMap(amountsIn).filter(found => found.marked || found.decimals);
    return all.length > 0 ? Math.max(...all.map(found => found.paise)) : null;
}

function upiAmount(lines: string[]): { paise: number; readAs: number | null } | null {
    // The amount stands on a line of its own, large, near the top: "₹450", "₹ 1,250.00", or "%450" from OCR
    for (const line of lines) {
        const standalone = /^\s*(₹|¥|rs\.?|inr|%|x|z)?\s?(\d[\d,]*(\.\d{1,2})?)\s*$/i.exec(line);
        if (!standalone) continue;
        const [found] = amountsIn(line);
        if (!found) continue;
        // No rupee sign at all, and a leading 3 or 2: the sign was most likely read as that digit
        const digits = standalone[2]!;
        if (!standalone[1] && /^[23]\d/.test(digits)) {
            const [rest] = amountsIn(digits.slice(1).replace(/^,/, ''));
            if (rest) return { paise: rest.paise, readAs: found.paise };
        }
        return { paise: found.paise, readAs: null };
    }
    for (const line of lines) {
        if (/\b(paid|sent|received|amount)\b/i.test(line)) {
            const marked = amountsIn(line).filter(found => found.marked);
            if (marked.length > 0) return { paise: marked[0]!.paise, readAs: null };
        }
    }
    const marked = lines.flatMap(amountsIn).filter(found => found.marked);
    return marked.length > 0 ? { paise: marked[0]!.paise, readAs: null } : null;
}

const DATE_PATTERNS = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/,
    /\b\d{1,2}\s*[-/ ]?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[-/ ,]*\d{2,4}\b/i,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i,
];

/** The first date that can be the day of the payment: not in the future, and within two years */
function findDate(lines: string[], today: string): string | null {
    const earliest = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
    for (const line of lines) {
        for (const pattern of DATE_PATTERNS) {
            const match = pattern.exec(line);
            if (!match) continue;
            const date = parseDate(match[0].replace(/sept/i, 'sep').replace(/\s*[-/]\s*/g, ' ').replace(/(\d)\s*([a-z])/i, '$1 $2'), 'dmy')
                ?? parseDate(match[0], 'dmy');
            if (date && date <= today && date >= earliest) return date;
        }
    }
    return null;
}

/** A merchant's name as read: without a UPI id or trailing punctuation, capitals softened */
function cleanName(raw: string): string | null {
    const name = raw.replace(/\S+@\S+/g, '').replace(/[|:;*_~]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^a-z0-9]+|[^a-z0-9).]+$/gi, '');
    if (!/[a-z]{2}/i.test(name) || name.length > 60) return null;
    return softenCapitals(name);
}

function upiMerchant(lines: string[]): string | null {
    for (const [index, line] of lines.entries()) {
        const match = /^(?:paid\s+(?:successfully\s+)?to|payment\s+to|sent\s+to|to)\b[:\s]*(.*)$/i.exec(line);
        if (!match) continue;
        const name = cleanName(match[1] ?? '') ?? cleanName(lines[index + 1] ?? '');
        if (name) return name;
    }
    return null;
}

const NOT_A_NAME = /tax\s*invoice|invoice|receipt|\bbill\b|cash\s*memo|gstin|\bgst\b|\bfssai\b|phone|\bph\b|\btel\b|mobile|\bdate\b|\btime\b|welcome|thank|order|table|token|customer|duplicate|original|copy/i;

function receiptMerchant(lines: string[]): string | null {
    for (const line of lines.slice(0, 6)) {
        if (NOT_A_NAME.test(line)) continue;
        const letters = (line.match(/[a-z]/gi) ?? []).length;
        // A name is mostly letters; an address line is full of numbers
        if (letters < 3 || letters / line.replace(/\s/g, '').length < 0.6) continue;
        const name = cleanName(line);
        if (name) return name;
    }
    return null;
}

/** Read what a receipt or screenshot says; `today` (YYYY-MM-DD) bounds the date */
export function readReceiptText(raw: string, today: string): ReceiptReading {
    const lines = raw.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const upi = UPI_WORDS.test(raw);
    const fromUpi = upi ? upiAmount(lines) : null;
    const paise = fromUpi?.paise ?? receiptAmount(lines);
    return {
        kind: upi ? 'upi' : 'receipt',
        amount: paise === null ? null : text(paise),
        readAs: fromUpi?.readAs ? text(fromUpi.readAs) : null,
        date: findDate(lines, today),
        merchant: upi ? upiMerchant(lines) ?? receiptMerchant(lines) : receiptMerchant(lines),
    };
}

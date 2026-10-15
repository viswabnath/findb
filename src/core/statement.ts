/**
 * Reading bank and card statements (v2 plan, Phase 2: statement import). Pure functions on the
 * table of text a CSV or Excel file holds, shared by the browser (which reads the file, so the file
 * itself never leaves the device) and the server (which checks what it is sent).
 *
 * - parseCsv: a CSV or other delimited text file as rows of cells;
 * - detectLayout: the header row and which column holds what, with the known bank layout if any;
 * - readRows: the statement's transactions as dated, signed amounts in paise;
 * - tidyDescription: a short description from a bank's narration ("UPI-SWIGGY-..." is "Swiggy").
 *
 * Amounts are worked out on the decimal text, never in floating point. A positive amount moves money
 * into the account (a deposit, or a payment towards a card); a negative one moves it out (a
 * withdrawal, or a purchase on a card).
 */

export type Table = string[][];

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** Which column (by index) holds what; null when the statement has no such column */
export interface Mapping {
    date: number;
    description: number;
    /** Two amount columns: money out and money in */
    debit: number | null;
    credit: number | null;
    /** One amount column, with an optional Dr/Cr column beside it */
    amount: number | null;
    direction: number | null;
    balance: number | null;
    reference: number | null;
    dateOrder: DateOrder;
    /** One amount column with no Dr/Cr: whether a positive amount is money in or money out */
    positive: 'in' | 'out';
}

export type MappingField = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'direction' | 'balance' | 'reference';
export const MAPPING_FIELDS: readonly MappingField[] = ['date', 'description', 'debit', 'credit', 'amount', 'direction', 'balance', 'reference'];

export interface StatementRow {
    /** The row's line in the file, from 1, so the user can find it */
    line: number;
    /** YYYY-MM-DD */
    date: string;
    /** Short, from tidyDescription; the user can change it */
    description: string;
    /** As the statement has it, for finding categories and transfers */
    narration: string;
    /** Positive into the account, negative out of it */
    paise: number;
    /** The balance after this row, when the statement shows it (a card's is negative when money is owed) */
    balancePaise: number | null;
    reference: string | null;
}

/** The most rows one import takes */
export const MAX_IMPORT_ROWS = 1000;
/** How far down the file the header row is looked for (statements start with the account's details) */
const HEADER_SEARCH_ROWS = 60;

// ----- CSV -----

const DELIMITERS = [',', ';', '\t', '|'];

/** The delimiter used most on the file's first lines, outside quotes */
function detectDelimiter(text: string): string {
    const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
    let best = ',';
    let bestCount = 0;
    for (const delimiter of DELIMITERS) {
        let count = 0;
        let quoted = false;
        for (const char of sample) {
            if (char === '"') quoted = !quoted;
            else if (char === delimiter && !quoted) count++;
        }
        if (count > bestCount) {
            best = delimiter;
            bestCount = count;
        }
    }
    return best;
}

/**
 * Rows of cells from delimited text (RFC 4180): quoted cells may hold delimiters, line breaks and
 * doubled quotes. Cells are trimmed; blank lines are kept as empty rows so line numbers match the file.
 */
export function parseCsv(text: string): Table {
    const source = text.replace(/^﻿/, '');
    const delimiter = detectDelimiter(source);
    const rows: Table = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
        const char = source[i]!;
        if (quoted) {
            if (char === '"' && source[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"' && cell.trim() === '') {
            quoted = true;
            cell = '';
        } else if (char === delimiter) {
            row.push(cell.trim());
            cell = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[i + 1] === '\n') i++;
            row.push(cell.trim());
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell.trim());
        rows.push(row);
    }
    return rows;
}

// ----- Columns -----

/** A header as compared: lower case, without punctuation or a currency note ("Withdrawal Amt." is "withdrawal amt") */
export function normaliseHeader(header: string): string {
    return header.toLowerCase()
        .replace(/\((?:in\s*)?(?:inr|rs\.?|₹)\s*\)/g, ' ')
        .replace(/[^a-z0-9/]+/g, ' ')
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Header names for each column, best first */
const SYNONYMS: Record<MappingField, string[]> = {
    date: ['txn date', 'transaction date', 'tran date', 'trans date', 'date', 'posting date', 'value date', 'value dt'],
    description: ['narration', 'description', 'particulars', 'transaction remarks', 'transaction details', 'transaction description',
        'transaction particulars', 'details', 'remarks', 'merchant name'],
    debit: ['withdrawal amt', 'withdrawal amount', 'withdrawals', 'withdrawal', 'debit amount', 'debit', 'debits', 'dr amount', 'dr',
        'money out', 'paid out'],
    credit: ['deposit amt', 'deposit amount', 'deposits', 'deposit', 'credit amount', 'credit', 'credits', 'cr amount', 'cr',
        'money in', 'paid in'],
    amount: ['amount', 'transaction amount', 'txn amount', 'amt'],
    direction: ['dr/cr', 'cr/dr', 'debit/credit', 'credit/debit', 'd/c', 'type', 'transaction type', 'txn type'],
    balance: ['closing balance', 'balance', 'bal', 'running balance', 'available balance'],
    reference: ['chq/ref no', 'ref no/cheque no', 'cheque number', 'cheque no', 'chq no', 'chqno', 'reference number', 'reference',
        'ref no', 'utr', 'transaction id'],
};

/** Each field's column in a header row, by its name; null where there is none */
export function detectColumns(header: string[]): Record<MappingField, number | null> {
    const names = header.map(normaliseHeader);
    const used = new Set<number>();
    const find = (field: MappingField, after = -1): number | null => {
        for (const synonym of SYNONYMS[field]) {
            const matches = names.map((name, index) => (name === synonym && !used.has(index) ? index : -1)).filter(index => index >= 0);
            // Kotak's layout has a Dr/Cr column after the amount and another after the balance
            const index = matches.find(match => match > after) ?? matches[0];
            if (index !== undefined) {
                used.add(index);
                return index;
            }
        }
        return null;
    };
    const date = find('date');
    const description = find('description');
    const debit = find('debit');
    const credit = find('credit');
    const amount = find('amount');
    const direction = amount === null ? null : find('direction', amount);
    const balance = find('balance');
    const reference = find('reference');
    return { date, description, debit, credit, amount, direction, balance, reference };
}

// ----- Known layouts -----

export interface Preset {
    key: string;
    /** The bank or card issuer, as written */
    bank: string;
    kind: 'bank' | 'card';
    /** Headers the layout has (normalised); all must be there */
    headers: string[];
}

/**
 * The statement layouts of the banks and card issuers decided for Phase 2 (HDFC, ICICI, SBI, Axis,
 * Kotak; docs/v2-plan.md), as their downloads name the columns. Any other layout works too, by
 * choosing the columns once; the choice is remembered for that layout.
 */
export const PRESETS: readonly Preset[] = [
    { key: 'hdfc_account', bank: 'HDFC Bank', kind: 'bank', headers: ['date', 'narration', 'chq/ref no', 'value dt', 'withdrawal amt', 'deposit amt', 'closing balance'] },
    { key: 'icici_account', bank: 'ICICI Bank', kind: 'bank', headers: ['value date', 'transaction date', 'cheque number', 'transaction remarks', 'withdrawal amount', 'deposit amount', 'balance'] },
    { key: 'sbi_account', bank: 'SBI', kind: 'bank', headers: ['txn date', 'value date', 'description', 'ref no/cheque no', 'debit', 'credit', 'balance'] },
    { key: 'axis_account', bank: 'Axis Bank', kind: 'bank', headers: ['tran date', 'chqno', 'particulars', 'dr', 'cr', 'bal'] },
    { key: 'kotak_account', bank: 'Kotak Mahindra Bank', kind: 'bank', headers: ['date', 'description', 'chq/ref no', 'amount', 'dr/cr', 'balance'] },
    { key: 'hdfc_card', bank: 'HDFC Bank', kind: 'card', headers: ['date', 'transaction description', 'amount', 'debit/credit'] },
    { key: 'icici_card', bank: 'ICICI Bank', kind: 'card', headers: ['transaction date', 'details', 'amount', 'reference number'] },
    { key: 'sbi_card', bank: 'SBI Card', kind: 'card', headers: ['date', 'transaction details', 'amount', 'type'] },
    { key: 'axis_card', bank: 'Axis Bank', kind: 'card', headers: ['date', 'transaction details', 'merchant category', 'amount', 'debit/credit'] },
    { key: 'kotak_card', bank: 'Kotak Mahindra Bank', kind: 'card', headers: ['date', 'transaction details', 'amount', 'dr/cr'] },
];

/** The known layout a header row is, if any */
export function findPreset(header: string[]): Preset | null {
    const names = new Set(header.map(normaliseHeader));
    return PRESETS.find(preset => preset.headers.every(name => names.has(name))) ?? null;
}

/** A layout's fingerprint: its normalised headers in order. A remembered column choice is found by it */
export function layoutSignature(header: string[]): string {
    return header.map(normaliseHeader).join('|').slice(0, 500);
}

export interface Layout {
    /** Index of the header row in the table */
    headerRow: number;
    header: string[];
    preset: Preset | null;
    /** Null when the columns could not be told apart: the user chooses them */
    mapping: Mapping | null;
}

/** Whether a mapping names a date, a description and at least one amount column */
export function mappingProblem(mapping: Mapping, columns: number): MappingField | 'amount' | null {
    const inRange = (index: number | null) => index === null || (Number.isInteger(index) && index >= 0 && index < columns);
    for (const field of MAPPING_FIELDS) if (!inRange(mapping[field])) return field;
    if (mapping.date === null || mapping.date === undefined) return 'date';
    if (mapping.description === null || mapping.description === undefined) return 'description';
    if (mapping.amount === null && mapping.debit === null && mapping.credit === null) return 'amount';
    return null;
}

/**
 * Find the header row (statements start with the account holder's details) and the columns. For a
 * card, one amount column with no Dr/Cr marks purchases as positive; for an account, deposits.
 */
export function detectLayout(table: Table, accountKind: 'bank' | 'card'): Layout | null {
    const limit = Math.min(table.length, HEADER_SEARCH_ROWS);
    let fallback: Layout | null = null;
    for (let index = 0; index < limit; index++) {
        const header = table[index]!;
        const columns = detectColumns(header);
        const hasAmount = columns.amount !== null || columns.debit !== null || columns.credit !== null;
        if (columns.date === null || columns.description === null || !hasAmount) {
            // The first row of three or more words, none of them a number or date, is probably the
            // header, with names we do not know: the user chooses the columns
            const filled = header.filter(cell => cell.trim() !== '');
            if (!fallback && filled.length >= 3 && filled.every(cell => /[a-z]{2}/i.test(cell) && !/\d{2}/.test(cell))) {
                fallback = { headerRow: index, header, preset: null, mapping: null };
            }
            continue;
        }
        const preset = findPreset(header);
        const kind = preset?.kind ?? accountKind;
        const body = table.slice(index + 1, index + 1 + 200);
        const mapping: Mapping = {
            date: columns.date, description: columns.description,
            debit: columns.debit, credit: columns.credit,
            // Two amount columns win over one
            amount: columns.debit !== null || columns.credit !== null ? null : columns.amount,
            direction: columns.debit !== null || columns.credit !== null ? null : columns.direction,
            balance: columns.balance, reference: columns.reference,
            dateOrder: guessDateOrder(body.map(row => row[columns.date!] ?? '')),
            positive: kind === 'card' ? 'out' : 'in',
        };
        return { headerRow: index, header, preset, mapping };
    }
    return fallback;
}

// ----- Dates -----

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function validDate(year: number, month: number, day: number): string | null {
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
    if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
}

const fullYear = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** A statement's date as YYYY-MM-DD: 01/10/2026, 1-10-26, 01 Oct 2026, 01-Oct-26, Oct 1, 2026, 2026-10-01 (a time after it is ignored) */
export function parseDate(text: string, order: DateOrder): string | null {
    const value = text.trim();
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/.exec(value);
    if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d])/.exec(value);
    if (match) {
        const [first, second] = [Number(match[1]), Number(match[2])];
        const year = fullYear(match[3]!);
        if (order === 'mdy') return validDate(year, first, second);
        if (order === 'ymd') return null;
        return validDate(year, second, first);
    }
    match = /^(\d{1,2})[-/ .]?([A-Za-z]{3,9})[-/ .,]*(\d{4}|\d{2})(?![\d])/.exec(value);
    if (match && monthNumber(match[2]!) > 0) return validDate(fullYear(match[3]!), monthNumber(match[2]!), Number(match[1]));
    match = /^([A-Za-z]{3,9})[-/ .]+(\d{1,2}),?[-/ .]+(\d{4})(?![\d])/.exec(value);
    if (match && monthNumber(match[1]!) > 0) return validDate(Number(match[3]), monthNumber(match[1]!), Number(match[2]));
    return null;
}

/** Day first unless a date shows otherwise (13/01 is day first; 01/13 month first). Year first only for 2026-10-01 */
export function guessDateOrder(values: string[]): DateOrder {
    let dayFirst = false;
    let monthFirst = false;
    let yearFirst = 0;
    let others = 0;
    for (const value of values) {
        const text = value.trim();
        if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) {
            yearFirst++;
            continue;
        }
        const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(text);
        if (!match) continue;
        others++;
        if (Number(match[1]) > 12) dayFirst = true;
        if (Number(match[2]) > 12) monthFirst = true;
    }
    if (yearFirst > 0 && others === 0) return 'ymd';
    return monthFirst && !dayFirst ? 'mdy' : 'dmy';
}

// ----- Amounts -----

/** Whole paise from decimal text, rounded half away from zero; null if it is not a number */
function paiseOf(text: string): number | null {
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(text)) return null;
    const [whole = '0', fraction = ''] = text.split('.');
    const paise = Number((whole || '0') + (fraction + '00').slice(0, 2)) + (Number((fraction + '000').charAt(2)) >= 5 ? 1 : 0);
    return Number.isSafeInteger(paise) ? paise : null;
}

/**
 * An amount as a statement writes it: "1,23,456.78", "₹ 500", "(250.00)", "1,200.00 Dr", "Cr 50",
 * "-75". Returns the paise, negative when written so, and the Dr/Cr mark if there is one.
 */
export function parseAmount(text: string): { paise: number; mark: 'dr' | 'cr' | null } | null {
    let value = text.trim().toLowerCase();
    if (!value) return null;
    let mark: 'dr' | 'cr' | null = null;
    const marked = /^(dr|cr)\.?\s*|\s*(dr|cr)\.?$/.exec(value);
    if (marked) {
        mark = (marked[1] ?? marked[2]) as 'dr' | 'cr';
        value = value.replace(marked[0], '');
    }
    value = value.replace(/₹|rs\.?|inr|,|\s/g, '');
    let negative = false;
    if (/^\(.*\)$/.test(value)) {
        negative = true;
        value = value.slice(1, -1);
    }
    if (value.startsWith('-')) {
        negative = !negative;
        value = value.slice(1);
    } else if (value.endsWith('-')) {
        negative = !negative;
        value = value.slice(0, -1);
    } else if (value.startsWith('+')) {
        value = value.slice(1);
    }
    const paise = paiseOf(value);
    if (paise === null) return null;
    return { paise: negative ? -paise : paise, mark };
}

// ----- Rows -----

const cellOf = (row: string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());

/** The signed amount of one row, or null if it has none */
function rowPaise(row: string[], mapping: Mapping): number | null {
    if (mapping.debit !== null || mapping.credit !== null) {
        const out = parseAmount(cellOf(row, mapping.debit));
        const into = parseAmount(cellOf(row, mapping.credit));
        if (!out && !into) return null;
        return Math.abs(into?.paise ?? 0) - Math.abs(out?.paise ?? 0);
    }
    const amount = parseAmount(cellOf(row, mapping.amount));
    if (!amount) return null;
    const size = Math.abs(amount.paise);
    const direction = cellOf(row, mapping.direction).toLowerCase();
    if (/^(d|dr|debit|withdrawal)\b/.test(direction)) return -size;
    if (/^(c|cr|credit|deposit)\b/.test(direction)) return size;
    if (amount.mark === 'dr') return -size;
    if (amount.mark === 'cr') return size;
    const positiveIn = mapping.positive === 'in';
    return amount.paise >= 0 === positiveIn ? size : -size;
}

/**
 * The statement's transactions: every row under the header with a date and an amount. Other rows
 * (opening balance lines, totals, notes at the end) are left out and counted. At most `limit` rows.
 */
export function readRows(table: Table, headerRow: number, mapping: Mapping, limit = MAX_IMPORT_ROWS): { rows: StatementRow[]; skipped: number; tooMany: boolean } {
    const rows: StatementRow[] = [];
    let skipped = 0;
    let tooMany = false;
    for (let index = headerRow + 1; index < table.length; index++) {
        const row = table[index]!;
        if (row.every(cell => cell.trim() === '')) continue;
        const date = parseDate(cellOf(row, mapping.date), mapping.dateOrder);
        const paise = date ? rowPaise(row, mapping) : null;
        if (!date || paise === null || paise === 0) {
            skipped++;
            continue;
        }
        if (rows.length >= limit) {
            tooMany = true;
            break;
        }
        const narration = cellOf(row, mapping.description).replace(/\s+/g, ' ');
        const reference = cellOf(row, mapping.reference) || null;
        const balance = parseAmount(cellOf(row, mapping.balance));
        rows.push({
            line: index + 1, date, narration: narration.slice(0, 500), description: tidyDescription(narration || reference || ''),
            paise, balancePaise: balance ? (balance.mark === 'dr' ? -Math.abs(balance.paise) : balance.paise) : null,
            reference: reference ? reference.slice(0, 100) : null,
        });
    }
    return { rows, skipped, tooMany };
}

/**
 * The balance the statement ends with: the balance on its last transaction by date. Statements
 * list newest first or oldest first, so the order is read from the dates.
 */
export function closingBalance(rows: Pick<StatementRow, 'date' | 'balancePaise'>[]): { date: string; paise: number } | null {
    const withBalance = rows.filter(row => row.balancePaise !== null);
    if (withBalance.length === 0) return null;
    const first = withBalance[0]!;
    const last = withBalance[withBalance.length - 1]!;
    const newestFirst = first.date > last.date;
    const closing = newestFirst ? first : last;
    return { date: closing.date, paise: closing.balancePaise! };
}

// ----- Descriptions -----

/** Bank codes that appear between the parts of a UPI narration */
const BANK_CODES = new Set(['YESB', 'HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'PUNB', 'BARB', 'IDIB', 'CNRB', 'UBIN', 'AIRP', 'PYTM',
    'FDRL', 'INDB', 'IDFB', 'AXIS', 'SBI', 'ICICI', 'KOTAK', 'PAYTM', 'YBL', 'OKAXIS', 'OKSBI', 'OKHDFCBANK', 'OKICICI']);
const NOT_NAMES = new Set(['UPI', 'DR', 'CR', 'P2A', 'P2M', 'NEFT', 'IMPS', 'RTGS', 'MB', 'IB', 'TO', 'FROM', 'TRANSFER', 'PAYMENT',
    'PAY', 'SENT', 'RECEIVED', 'REV', 'NA', 'NULL', 'UPIINTENT', 'COLLECT']);

/** Whether a part of a narration could be a name: words, not a reference, account, IFSC or UPI id */
function looksLikeName(part: string): boolean {
    const text = part.trim();
    if (text.length < 2 || text.includes('@')) return false;
    if (!/[A-Za-z]{2}/.test(text)) return false;
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(text)) return false;
    if (/\d{4,}/.test(text) || /x{3,}/i.test(text)) return false;
    const upper = text.toUpperCase();
    return !BANK_CODES.has(upper) && !NOT_NAMES.has(upper);
}

/** Capitals in each word when the text is all capitals ("SWIGGY LIMITED" is "Swiggy Limited") */
export function softenCapitals(text: string): string {
    if (text !== text.toUpperCase()) return text;
    return text.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

/**
 * A short description from a narration: the payee of a UPI, IMPS or NEFT payment, the merchant of a
 * card payment at a shop (POS); otherwise the narration itself. At most 200 characters (an entry's
 * description).
 */
export function tidyDescription(narration: string): string {
    const text = narration.replace(/\s+/g, ' ').trim();
    const transfer = /\b(UPI|IMPS|NEFT|RTGS)\b/i.exec(text);
    if (transfer) {
        const after = text.slice(transfer.index + transfer[0].length);
        const name = after.split(/[/\-:]+/).find(looksLikeName);
        if (name) return softenCapitals(name.trim()).slice(0, 200);
    }
    const pos = /^POS\s+(?:\S*\d\S*\s+)?(.+)$/i.exec(text);
    if (pos) return softenCapitals(pos[1]!.trim()).slice(0, 200);
    return text.slice(0, 200);
}

/** What a narration says about a transfer between the user's own accounts */
export type TransferHint = 'atm' | 'card_payment' | 'self';

/** ATM withdrawals, credit card bill payments, and transfers to the user's own accounts, by their words */
export function transferHint(narration: string): TransferHint | null {
    const text = narration.toLowerCase();
    if (/\b(atm|atw|nwd|cash wdl|cash withdrawal|cwdr)\b/.test(text)) return 'atm';
    if (/credit ?card|card ?payment|cc ?payment|cc ?bill|card bill|payment received|thank you for (your )?payment|autopay/.test(text)) return 'card_payment';
    if (/\b(self|own account|to own|sweep)\b/.test(text)) return 'self';
    return null;
}

/** Whole paise as rupees text with two decimals, as the API takes amounts: -45000 is "-450.00" */
export function paiseText(paise: number): string {
    const unsigned = Math.abs(paise);
    const text = `${Math.floor(unsigned / 100)}.${String(unsigned % 100).padStart(2, '0')}`;
    return paise < 0 ? `-${text}` : text;
}

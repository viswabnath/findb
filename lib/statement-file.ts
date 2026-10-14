import { parseCsv, type Table } from '../src/core/statement';

/**
 * Reading a statement file in the browser (v2 Phase 2: statement import), so the file itself never
 * leaves the device: CSV and other delimited text directly, Excel (.xls, .xlsx, and the HTML tables
 * some banks save as .xls) with SheetJS, loaded only when an Excel file is chosen.
 */

/** The largest statement file read (a year of a busy account is well under this) */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type FileKind = 'csv' | 'excel';
export type FileProblem = 'tooLarge' | 'unreadable' | 'password' | 'empty';

export class StatementFileError extends Error {
    constructor(readonly problem: FileProblem) {
        super(problem);
    }
}

const EXCEL = /\.(xlsx|xlsm|xls)$/i;

const pad = (n: number) => String(n).padStart(2, '0');

/** A spreadsheet cell as the text a CSV would hold: dates as YYYY-MM-DD, amounts without float noise */
function cellText(value: unknown): string {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

/** The file as rows of cells, and whether it was CSV or Excel */
export async function readStatementFile(file: File): Promise<{ table: Table; kind: FileKind }> {
    if (file.size > MAX_FILE_BYTES) throw new StatementFileError('tooLarge');
    if (file.size === 0) throw new StatementFileError('empty');
    if (!EXCEL.test(file.name)) {
        const table = parseCsv(await file.text());
        if (table.length === 0) throw new StatementFileError('empty');
        return { table, kind: 'csv' };
    }
    const XLSX = await import('xlsx');
    let workbook;
    try {
        workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: true });
    } catch (error) {
        throw new StatementFileError(/password|encrypt/i.test(String(error)) ? 'password' : 'unreadable');
    }
    // The sheet with the most rows: statements put the transactions on one sheet
    let best: Table = [];
    for (const name of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, raw: true, defval: '', blankrows: true });
        const table = rows.map(row => (Array.isArray(row) ? row.map(cellText) : []));
        if (table.length > best.length) best = table;
    }
    if (best.length === 0) throw new StatementFileError('empty');
    return { table: best, kind: 'excel' };
}

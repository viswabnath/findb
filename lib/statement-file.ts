import { parseCsv, type Table } from '../src/core/statement';
import { MAX_PDF_PAGES, pdfTable, type TextPiece } from '../src/core/statement-pdf';

/**
 * Reading a statement file in the browser (v2 Phase 2: statement import), so the file itself never
 * leaves the device: CSV and other delimited text directly, Excel (.xls, .xlsx, and the HTML tables
 * some banks save as .xls) with SheetJS, and PDF with pdf.js (src/core/statement-pdf.ts puts its
 * text back into rows). Both libraries load only when such a file is chosen. A PDF's password is
 * used only here, to open the file, and is never sent or kept.
 */

/** The largest statement file read (a year of a busy account is well under this) */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type FileKind = 'csv' | 'excel' | 'pdf';
/** password: an Excel file locked with one; pdfPassword and pdfWrongPassword: a PDF that needs one; pdfNoText: a scan */
export type FileProblem = 'tooLarge' | 'unreadable' | 'password' | 'empty' | 'pdfPassword' | 'pdfWrongPassword' | 'pdfNoText' | 'pdfTooLong';

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

/** Whether the file is a PDF: by its name, or by how it starts (%PDF) */
export async function isPdf(file: File): Promise<boolean> {
    if (/\.pdf$/i.test(file.name)) return true;
    return (await file.slice(0, 5).text()) === '%PDF-';
}

interface PdfTextItem { str?: string; transform?: number[]; width?: number }

/** A PDF's text pieces, page by page; the password opens a protected one */
async function readPdf(file: File, password: string | undefined): Promise<Table> {
    const pdfjs = await import('pdfjs-dist');
    // pdf.js runs on this page instead of in a Web Worker: a statement is small, and no worker
    // script or exception to the Content-Security-Policy is needed
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    let document;
    try {
        document = await pdfjs.getDocument({
            data: new Uint8Array(await file.arrayBuffer()), password, disableFontFace: true, useSystemFonts: false,
        }).promise;
    } catch (error) {
        const code = (error as { name?: string; code?: number }).name === 'PasswordException' ? (error as { code?: number }).code : null;
        if (code === pdfjs.PasswordResponses.NEED_PASSWORD) throw new StatementFileError('pdfPassword');
        if (code === pdfjs.PasswordResponses.INCORRECT_PASSWORD) throw new StatementFileError('pdfWrongPassword');
        throw new StatementFileError('unreadable');
    }
    try {
        if (document.numPages > MAX_PDF_PAGES) throw new StatementFileError('pdfTooLong');
        const pages: TextPiece[][] = [];
        for (let number = 1; number <= document.numPages; number++) {
            const page = await document.getPage(number);
            const content = await page.getTextContent();
            pages.push((content.items as PdfTextItem[]).flatMap(item => (typeof item.str === 'string' && item.transform
                ? [{ text: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width ?? 0 }] : [])));
            page.cleanup();
        }
        if (pages.every(page => page.every(piece => piece.text.trim() === ''))) throw new StatementFileError('pdfNoText');
        return pdfTable(pages);
    } finally {
        await document.loadingTask.destroy();
    }
}

/** The file as rows of cells, and whether it was CSV, Excel or PDF; `password` opens a protected PDF */
export async function readStatementFile(file: File, password?: string): Promise<{ table: Table; kind: FileKind }> {
    if (file.size > MAX_FILE_BYTES) throw new StatementFileError('tooLarge');
    if (file.size === 0) throw new StatementFileError('empty');
    if (await isPdf(file)) {
        const table = await readPdf(file, password);
        if (table.length === 0) throw new StatementFileError('empty');
        return { table, kind: 'pdf' };
    }
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

/**
 * A PDF statement as the table a CSV would hold (v2 plan, Phase 2: PDF statements). A PDF has no
 * rows or columns, only pieces of text at positions; this puts them back together:
 *
 * - pieces on the same baseline make a line, and pieces close together on a line make a cell;
 * - the statement's header line (found by its column names, src/core/statement.ts, also when the
 *   names wrap onto a second line) gives the columns, and every later cell goes to the column it
 *   sits under;
 * - a line with only description text, just under a transaction, continues that transaction's
 *   description (banks wrap long narrations);
 * - without a header, each line's cells are given as they are, for the user to choose the columns.
 *
 * Positions are PDF units (1/72 inch), y measured up from the bottom of the page.
 */
import { detectColumns, type Table } from './statement';

export interface TextPiece {
    text: string;
    x: number;
    /** The baseline, up from the bottom of the page */
    y: number;
    width: number;
}

interface Cell { text: string; x0: number; x1: number }
interface Line { page: number; y: number; cells: Cell[] }

/** How far apart (units) two pieces' baselines may be and still be one line */
const SAME_LINE = 3;
/** A gap wider than this between pieces starts a new cell: wider than a word space (about 2.5 at 9 point), narrower than columns */
const CELL_GAP = 4;
/** The most PDF pages read (a year of a busy account is far less) */
export const MAX_PDF_PAGES = 100;

function linesOf(pages: TextPiece[][]): Line[] {
    const lines: Line[] = [];
    pages.forEach((pieces, page) => {
        const sorted = pieces.filter(piece => piece.text.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
        const pageLines: { y: number; pieces: TextPiece[] }[] = [];
        for (const piece of sorted) {
            const line = pageLines.find(item => Math.abs(item.y - piece.y) <= SAME_LINE);
            if (line) line.pieces.push(piece);
            else pageLines.push({ y: piece.y, pieces: [piece] });
        }
        for (const line of pageLines.sort((a, b) => b.y - a.y)) {
            const cells: Cell[] = [];
            for (const piece of line.pieces.sort((a, b) => a.x - b.x)) {
                const last = cells[cells.length - 1];
                const gap = last ? piece.x - last.x1 : Infinity;
                if (last && gap < CELL_GAP) {
                    last.text += (gap > 0.5 && !last.text.endsWith(' ') && !piece.text.startsWith(' ') ? ' ' : '') + piece.text;
                    last.x1 = Math.max(last.x1, piece.x + piece.width);
                } else {
                    cells.push({ text: piece.text, x0: piece.x, x1: piece.x + piece.width });
                }
            }
            for (const cell of cells) cell.text = cell.text.replace(/\s+/g, ' ').trim();
            lines.push({ page, y: line.y, cells: cells.filter(cell => cell.text !== '') });
        }
    });
    return lines;
}

const overlaps = (a: Cell, b: Cell) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;

/** Two lines of a header that wraps ("Withdrawal" above "Amt."): cells that sit over each other are joined */
function joinLines(top: Cell[], bottom: Cell[]): Cell[] {
    const cells = top.map(cell => ({ ...cell }));
    for (const cell of bottom) {
        const over = cells.find(item => overlaps(item, cell));
        if (over) {
            over.text = `${over.text} ${cell.text}`;
            over.x0 = Math.min(over.x0, cell.x0);
            over.x1 = Math.max(over.x1, cell.x1);
        } else {
            cells.push({ ...cell });
        }
    }
    return cells.sort((a, b) => a.x0 - b.x0);
}

function isHeader(cells: Cell[]): boolean {
    const columns = detectColumns(cells.map(cell => cell.text));
    return columns.date !== null && columns.description !== null
        && (columns.amount !== null || columns.debit !== null || columns.credit !== null);
}

/** The column a cell sits under: the header it overlaps most, or the nearest by centre */
function columnOf(cell: Cell, header: Cell[]): number {
    let best = 0;
    let bestOverlap = 0;
    header.forEach((column, index) => {
        const overlap = Math.min(cell.x1, column.x1) - Math.max(cell.x0, column.x0);
        if (overlap > bestOverlap) {
            best = index;
            bestOverlap = overlap;
        }
    });
    if (bestOverlap > 0) return best;
    const centre = (cell.x0 + cell.x1) / 2;
    let nearest = 0;
    header.forEach((column, index) => {
        if (Math.abs((column.x0 + column.x1) / 2 - centre) < Math.abs((header[nearest]!.x0 + header[nearest]!.x1) / 2 - centre)) nearest = index;
    });
    return nearest;
}

/** The statement's text pieces, page by page, as rows of cells */
export function pdfTable(pages: TextPiece[][]): Table {
    const lines = linesOf(pages);
    let headerIndex = -1;
    let header: Cell[] = [];
    let headerLines = 1;
    // A header on one line first; only then one that wraps onto a second line
    for (let index = 0; index < lines.length && headerIndex < 0; index++) {
        if (isHeader(lines[index]!.cells)) {
            headerIndex = index;
            header = lines[index]!.cells;
        }
    }
    for (let index = 0; index < lines.length && headerIndex < 0; index++) {
        if (index + 1 < lines.length && lines[index + 1]!.page === lines[index]!.page) {
            const joined = joinLines(lines[index]!.cells, lines[index + 1]!.cells);
            if (isHeader(joined)) {
                headerIndex = index;
                header = joined;
                headerLines = 2;
            }
        }
    }
    if (headerIndex < 0) return lines.map(line => line.cells.map(cell => cell.text));

    const names = header.map(cell => cell.text);
    const columns = detectColumns(names);
    const amountColumns = [columns.debit, columns.credit, columns.amount, columns.balance].filter((index): index is number => index !== null);
    const headerText = names.join('|').toLowerCase();

    const table: Table = lines.slice(0, headerIndex).map(line => [line.cells.map(cell => cell.text).join(' ')]);
    table.push(names);
    let previous: { row: string[]; line: Line } | null = null;
    for (const line of lines.slice(headerIndex + headerLines)) {
        const row: string[] = names.map(() => '');
        for (const cell of line.cells) {
            const index = columnOf(cell, header);
            row[index] = row[index] ? `${row[index]} ${cell.text}` : cell.text;
        }
        // The header again at the top of the next page
        if (row.join('|').toLowerCase() === headerText || isHeader(line.cells)) {
            previous = null;
            continue;
        }
        const onlyDescription = row[columns.date!] === '' && amountColumns.every(index => row[index] === '') && row[columns.description!] !== '';
        const close = previous && previous.line.page === line.page && previous.line.y - line.y <= 14;
        if (onlyDescription && previous && close) {
            // A wrapped description: it continues the transaction above
            row.forEach((text, index) => {
                if (text) previous!.row[index] = previous!.row[index] ? `${previous!.row[index]} ${text}` : text;
            });
            previous.line = line;
            continue;
        }
        table.push(row);
        previous = row[columns.date!] !== '' ? { row, line } : null;
    }
    return table;
}

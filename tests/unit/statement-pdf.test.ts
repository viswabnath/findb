/**
 * Unit tests for src/core/statement-pdf.ts: a PDF statement's text pieces back into a table
 */
import { pdfTable, type TextPiece } from '../../src/core/statement-pdf';
import { detectLayout, readRows } from '../../src/core/statement';

/** Pieces for one line at a baseline: [x, text] pairs, about 4 units a character (9 point type) */
const line = (y: number, ...cells: [number, string][]): TextPiece[] => cells.map(([x, text]) => ({ x, y, text, width: text.length * 4 }));

// Columns as an HDFC statement lays them out; amounts right-aligned under their headings
const HEADER = line(700, [40, 'Date'], [100, 'Narration'], [300, 'Chq./Ref.No.'], [380, 'Value Dt'], [440, 'Withdrawal Amt.'], [520, 'Deposit Amt.'], [590, 'Closing Balance']);

describe('pdfTable', () => {
    test('puts each piece under its heading, joins wrapped narrations, and skips the heading repeated on the next page', () => {
        const page1 = [
            ...line(780, [40, 'HDFC BANK Ltd.'], [300, 'Statement of account']),
            ...HEADER,
            ...line(680, [40, '01/10/26'], [100, 'UPI-SWIGGY LIMITED-swiggy@hdfcbank'], [300, '0000412345'], [380, '01/10/26'], [470, '450.00'], [605, '9,550.00']),
            ...line(670, [100, '-HDFC0MERUPI-Payment']),
            ...line(655, [40, '03/10/26'], [100, 'NEFT CR-ACME PVT LTD'], [300, 'N123'], [380, '03/10/26'], [540, '5,000.00'], [600, '14,550.00']),
        ];
        const page2 = [
            ...HEADER,
            ...line(680, [40, '05/10/26'], [100, 'ATW-512345XXXXXX1234'], [380, '05/10/26'], [465, '2,000.00'], [600, '12,550.00']),
            ...line(100, [40, 'This is a computer generated statement']),
        ];
        const table = pdfTable([page1, page2]);
        expect(table[0]).toEqual(['HDFC BANK Ltd. Statement of account']);
        expect(table[1]).toEqual(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
        expect(table[2]).toEqual(['01/10/26', 'UPI-SWIGGY LIMITED-swiggy@hdfcbank -HDFC0MERUPI-Payment', '0000412345', '01/10/26', '450.00', '', '9,550.00']);
        expect(table[3]).toEqual(['03/10/26', 'NEFT CR-ACME PVT LTD', 'N123', '03/10/26', '', '5,000.00', '14,550.00']);
        expect(table[4]).toEqual(['05/10/26', 'ATW-512345XXXXXX1234', '', '05/10/26', '2,000.00', '', '12,550.00']);
        // Far below the last transaction: not part of its description
        expect(table[5]).toEqual(['', 'This is a computer generated statement', '', '', '', '', '']);

        const layout = detectLayout(table, 'bank')!;
        expect(layout.preset?.key).toBe('hdfc_account');
        const { rows } = readRows(table, layout.headerRow, layout.mapping!);
        expect(rows.map(row => [row.date, row.paise, row.balancePaise])).toEqual([
            ['2026-10-01', -45000, 955000], ['2026-10-03', 500000, 1455000], ['2026-10-05', -200000, 1255000],
        ]);
        expect(rows[0]!.description).toBe('Swiggy Limited');
    });

    test('a heading that wraps onto two lines', () => {
        const table = pdfTable([[
            ...line(700, [40, 'Txn'], [100, 'Description'], [300, 'Debit'], [380, 'Credit'], [460, 'Balance']),
            ...line(690, [40, 'Date']),
            ...line(670, [40, '1 Oct 2026'], [100, 'Interest credited'], [390, '12.00'], [460, '100.00']),
        ]]);
        expect(table[0]).toEqual(['Txn Date', 'Description', 'Debit', 'Credit', 'Balance']);
        expect(table[1]).toEqual(['1 Oct 2026', 'Interest credited', '', '12.00', '100.00']);
    });

    test('columns only a few units apart stay apart; a word space does not split a cell', () => {
        const table = pdfTable([[{ x: 360, y: 500, text: 'Value', width: 22 }, { x: 384.5, y: 500, text: 'Dt', width: 10 }, { x: 400, y: 500, text: 'Withdrawal Amt.', width: 65 }]]);
        expect(table).toEqual([['Value Dt', 'Withdrawal Amt.']]);
    });

    test('pieces close together are one cell; a wide gap starts another', () => {
        const table = pdfTable([[{ x: 40, y: 500, text: 'Opening', width: 35 }, { x: 77, y: 500, text: 'balance', width: 35 }, { x: 300, y: 501, text: '1,000.00', width: 40 }]]);
        expect(table).toEqual([['Opening balance', '1,000.00']]);
    });

    test('without a heading, the lines are given as they are, for the user to choose the columns', () => {
        const table = pdfTable([[...line(700, [40, 'When'], [100, 'What'], [300, 'How much']), ...line(680, [40, '01/10/2026'], [100, 'Tea'], [300, '20'])]]);
        expect(table).toEqual([['When', 'What', 'How much'], ['01/10/2026', 'Tea', '20']]);
    });

    test('a scanned PDF has no text: an empty table', () => {
        expect(pdfTable([[], []])).toEqual([]);
    });
});

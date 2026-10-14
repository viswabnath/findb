/**
 * Unit tests for src/core/statement.ts: reading bank and card statements
 */
import {
    closingBalance, detectColumns, detectLayout, findPreset, guessDateOrder, layoutSignature, mappingProblem, normaliseHeader,
    parseAmount, parseCsv, parseDate, readRows, tidyDescription, transferHint, type Mapping,
} from '../../src/core/statement';

describe('parseCsv', () => {
    test('quoted cells keep commas, line breaks and doubled quotes', () => {
        expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', 'two\nlines', '3']]);
    });

    test('finds the delimiter: semicolons, tabs and pipes', () => {
        expect(parseCsv('Date;Amount\n01/10/2026;5,00')).toEqual([['Date', 'Amount'], ['01/10/2026', '5,00']]);
        expect(parseCsv('Date\tAmount\n01/10/2026\t1,500.00')).toEqual([['Date', 'Amount'], ['01/10/2026', '1,500.00']]);
        expect(parseCsv('Date|Amount\n01/10/2026|1')).toEqual([['Date', 'Amount'], ['01/10/2026', '1']]);
    });

    test('drops the byte order mark, trims cells and keeps blank lines so line numbers match', () => {
        expect(parseCsv('﻿ Date , Narration \n\nx,y')).toEqual([['Date', 'Narration'], [''], ['x', 'y']]);
    });
});

describe('headers and layouts', () => {
    test('normaliseHeader drops punctuation and currency notes', () => {
        expect(normaliseHeader('Withdrawal Amt.')).toBe('withdrawal amt');
        expect(normaliseHeader('Chq./Ref.No.')).toBe('chq/ref no');
        expect(normaliseHeader('Withdrawal Amount (INR )')).toBe('withdrawal amount');
        expect(normaliseHeader('Amount (in Rs.)')).toBe('amount');
        expect(normaliseHeader('Dr / Cr')).toBe('dr/cr');
    });

    test('detectColumns prefers the transaction date to the value date', () => {
        const columns = detectColumns(['S No.', 'Value Date', 'Transaction Date', 'Cheque Number', 'Transaction Remarks',
            'Withdrawal Amount (INR )', 'Deposit Amount (INR )', 'Balance (INR )']);
        expect(columns).toEqual({ date: 2, description: 4, debit: 5, credit: 6, amount: null, direction: null, balance: 7, reference: 3 });
    });

    test('the Dr/Cr column after the amount, not the one after the balance', () => {
        const columns = detectColumns(['Sl. No.', 'Date', 'Description', 'Chq / Ref No.', 'Amount', 'Dr / Cr', 'Balance', 'Dr / Cr']);
        expect(columns).toMatchObject({ amount: 4, direction: 5, balance: 6 });
    });

    test.each([
        ['hdfc_account', ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']],
        ['icici_account', ['S No.', 'Value Date', 'Transaction Date', 'Cheque Number', 'Transaction Remarks', 'Withdrawal Amount (INR )', 'Deposit Amount (INR )', 'Balance (INR )']],
        ['sbi_account', ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance']],
        ['axis_account', ['Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL', 'SOL']],
        ['kotak_account', ['Sl. No.', 'Date', 'Description', 'Chq / Ref No.', 'Amount', 'Dr / Cr', 'Balance', 'Dr / Cr']],
        ['sbi_card', ['Date', 'Transaction Details', 'Amount', 'Type']],
    ])('recognises the %s layout', (key, header) => {
        expect(findPreset(header)?.key).toBe(key);
    });

    test('an unknown layout is no preset', () => {
        expect(findPreset(['When', 'What', 'How much'])).toBeNull();
    });

    test('layoutSignature is the same for the same columns, however written', () => {
        expect(layoutSignature(['Date', 'Withdrawal Amt.'])).toBe(layoutSignature([' date ', 'WITHDRAWAL AMT']));
        expect(layoutSignature(['Date', 'Amount'])).not.toBe(layoutSignature(['Amount', 'Date']));
    });
});

describe('detectLayout', () => {
    const hdfc = parseCsv([
        'HDFC BANK Ltd.,,,,,,',
        'Account No :,XXXXXXXX1234,,,,,',
        'Statement From : 01/10/2026 To : 31/10/2026,,,,,,',
        ',,,,,,',
        'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
        '01/10/26,UPI-SWIGGY LIMITED-swiggy.payu@hdfcbank-HDFC0MERUPI-412345678901-Payment,0000412345678901,01/10/26,450.00,,"49,550.00"',
        '03/10/26,NEFT CR-ICIC0000001-ACME PVT LTD-SALARY OCT-N123,N123,03/10/26,,"85,000.00","1,34,550.00"',
        '13/10/26,ATW-512345XXXXXX1234-S1ANMU01-MUMBAI,0000123,13/10/26,"2,000.00",,"1,32,550.00"',
        ',,,,,,',
        'STATEMENT SUMMARY :-,,,,,,',
        'Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,',
    ].join('\n'));

    test('finds the header under the account details, with the HDFC layout and day-first dates', () => {
        const layout = detectLayout(hdfc, 'bank')!;
        expect(layout.headerRow).toBe(4);
        expect(layout.preset?.key).toBe('hdfc_account');
        expect(layout.mapping).toMatchObject({ date: 0, description: 1, debit: 4, credit: 5, amount: null, balance: 6, reference: 2, dateOrder: 'dmy' });
    });

    test('readRows takes the transactions and leaves out the summary', () => {
        const layout = detectLayout(hdfc, 'bank')!;
        const { rows, skipped, tooMany } = readRows(hdfc, layout.headerRow, layout.mapping!);
        expect(tooMany).toBe(false);
        expect(skipped).toBe(2);
        expect(rows.map(row => [row.line, row.date, row.description, row.paise, row.balancePaise])).toEqual([
            [6, '2026-10-01', 'Swiggy Limited', -45000, 4955000],
            [7, '2026-10-03', 'Acme Pvt Ltd', 8500000, 13455000],
            [8, '2026-10-13', 'ATW-512345XXXXXX1234-S1ANMU01-MUMBAI', -200000, 13255000],
        ]);
        expect(rows[1]!.narration).toContain('SALARY OCT');
        expect(closingBalance(rows)).toEqual({ date: '2026-10-13', paise: 13255000 });
    });

    test('a card statement with one amount column: purchases positive unless marked Cr', () => {
        const table = parseCsv('Transaction Date,Details,Amount (INR),Reference Number\n02/10/2026,AMAZON PAY INDIA,1299.00,R1\n05/10/2026,PAYMENT RECEIVED - THANK YOU,"5,000.00 Cr",R2');
        const layout = detectLayout(table, 'card')!;
        expect(layout.preset?.key).toBe('icici_card');
        expect(layout.mapping?.positive).toBe('out');
        expect(readRows(table, layout.headerRow, layout.mapping!).rows.map(row => row.paise)).toEqual([-129900, 500000]);
    });

    test('an unknown header is still found, for the user to choose the columns', () => {
        const layout = detectLayout(parseCsv('My export\nWhen,What,How much,Notes\n01/10/2026,Tea,20,'), 'bank')!;
        expect(layout.headerRow).toBe(1);
        expect(layout.mapping).toBeNull();
    });

    test('nothing that looks like a statement', () => {
        expect(detectLayout(parseCsv('1,2,3\n4,5,6'), 'bank')).toBeNull();
    });
});

describe('readRows', () => {
    const base: Mapping = { date: 0, description: 1, debit: null, credit: null, amount: 2, direction: null, balance: null, reference: null, dateOrder: 'dmy', positive: 'in' };

    test('a Dr/Cr column decides the direction', () => {
        const table = [['h'], ['01/10/2026', 'Rent', '20,000.00', 'DR'], ['02/10/2026', 'Refund', '500', 'CR']];
        expect(readRows(table, 0, { ...base, direction: 3 }).rows.map(row => row.paise)).toEqual([-2000000, 50000]);
    });

    test('signed amounts on an account; zero and undated rows are skipped', () => {
        const table = [['h'], ['01/10/2026', 'Tea', '-20'], ['02/10/2026', 'Interest', '12.5'], ['03/10/2026', 'Nothing', '0'], ['Total', '', '100']];
        const { rows, skipped } = readRows(table, 0, base);
        expect(rows.map(row => row.paise)).toEqual([-2000, 1250]);
        expect(skipped).toBe(2);
    });

    test('stops at the limit and says so', () => {
        const table = [['h'], ...Array.from({ length: 5 }, (_, i) => [`0${i + 1}/10/2026`, 'x', '1'])];
        const result = readRows(table, 0, base, 3);
        expect(result.rows).toHaveLength(3);
        expect(result.tooMany).toBe(true);
    });

    test('an empty description uses the reference', () => {
        const table = [['h'], ['01/10/2026', '', '5', 'REF42']];
        expect(readRows(table, 0, { ...base, reference: 3 }).rows[0]!.description).toBe('REF42');
    });
});

describe('mappingProblem', () => {
    const mapping: Mapping = { date: 0, description: 1, debit: null, credit: null, amount: 2, direction: null, balance: null, reference: null, dateOrder: 'dmy', positive: 'in' };

    test('needs a date, a description and an amount column, inside the table', () => {
        expect(mappingProblem(mapping, 3)).toBeNull();
        expect(mappingProblem({ ...mapping, amount: null }, 3)).toBe('amount');
        expect(mappingProblem({ ...mapping, balance: 7 }, 3)).toBe('balance');
        expect(mappingProblem({ ...mapping, date: -1 }, 3)).toBe('date');
    });
});

describe('dates', () => {
    test.each([
        ['01/10/2026', 'dmy', '2026-10-01'],
        ['1-10-26', 'dmy', '2026-10-01'],
        ['01.10.2026 10:15:00', 'dmy', '2026-10-01'],
        ['10/01/2026', 'mdy', '2026-10-01'],
        ['01 Oct 2026', 'dmy', '2026-10-01'],
        ['01-Oct-26', 'dmy', '2026-10-01'],
        ['1 October 2026', 'dmy', '2026-10-01'],
        ['Oct 1, 2026', 'dmy', '2026-10-01'],
        ['2026-10-01', 'dmy', '2026-10-01'],
        ['2026-10-01T00:00:00', 'dmy', '2026-10-01'],
    ] as const)('parseDate(%s, %s)', (text, order, expected) => {
        expect(parseDate(text, order)).toBe(expected);
    });

    test('impossible dates and other text are not dates', () => {
        expect(parseDate('31/02/2026', 'dmy')).toBeNull();
        expect(parseDate('Opening Balance', 'dmy')).toBeNull();
        expect(parseDate('', 'dmy')).toBeNull();
        expect(parseDate('12345', 'dmy')).toBeNull();
    });

    test('guessDateOrder: day first unless the dates show otherwise', () => {
        expect(guessDateOrder(['01/02/2026', '13/02/2026'])).toBe('dmy');
        expect(guessDateOrder(['02/13/2026', '02/01/2026'])).toBe('mdy');
        expect(guessDateOrder(['01/02/2026'])).toBe('dmy');
        expect(guessDateOrder(['2026-02-01'])).toBe('ymd');
    });
});

describe('parseAmount', () => {
    test.each([
        ['1,23,456.78', 12345678, null],
        ['₹ 500', 50000, null],
        ['Rs. 99.5', 9950, null],
        ['(250.00)', -25000, null],
        ['-75', -7500, null],
        ['75-', -7500, null],
        ['1,200.00 Dr', 120000, 'dr'],
        ['Cr 50', 5000, 'cr'],
        ['0.005', 1, null],
        ['10.004', 1000, null],
    ] as const)('%s', (text, paise, mark) => {
        expect(parseAmount(text)).toEqual({ paise, mark });
    });

    test('blank and non-numbers are null', () => {
        expect(parseAmount('')).toBeNull();
        expect(parseAmount('-')).toBeNull();
        expect(parseAmount('abc')).toBeNull();
        expect(parseAmount('1.2.3')).toBeNull();
    });
});

describe('descriptions', () => {
    test.each([
        ['UPI-SWIGGY LIMITED-swiggy.payu@hdfcbank-HDFC0MERUPI-412345678901-Payment', 'Swiggy Limited'],
        ['TO TRANSFER-UPI/DR/412345678901/RAVI KUMAR /YESB/ravi@ybl/UPI--', 'Ravi Kumar'],
        ['UPI/412345678901/Rent October/landlord@okaxis/Axis Bank', 'Rent October'],
        ['NEFT CR-ICIC0000001-ACME PVT LTD-SALARY OCT-N123', 'Acme Pvt Ltd'],
        ['IMPS-412345678901-Priya Sharma-HDFC-xxxx1234-dinner', 'Priya Sharma'],
        ['POS 512345XXXXXX1234 AMAZON PAY IN', 'Amazon Pay In'],
        ['  Interest   credited ', 'Interest credited'],
    ])('tidyDescription(%s)', (narration, expected) => {
        expect(tidyDescription(narration)).toBe(expected);
    });

    test('at most 200 characters', () => {
        expect(tidyDescription('x'.repeat(300))).toHaveLength(200);
    });

    test('transferHint finds ATM withdrawals, card bills and own transfers', () => {
        expect(transferHint('ATW-512345XXXXXX1234-S1ANMU01-MUMBAI')).toBe('atm');
        expect(transferHint('NWD-512345XXXXXX1234-ATM')).toBe('atm');
        expect(transferHint('BILLPAY CREDIT CARD 4321')).toBe('card_payment');
        expect(transferHint('PAYMENT RECEIVED - THANK YOU')).toBe('card_payment');
        expect(transferHint('UPI/DR/1234/SELF/HDFC')).toBe('self');
        expect(transferHint('UPI-SWIGGY')).toBeNull();
    });
});

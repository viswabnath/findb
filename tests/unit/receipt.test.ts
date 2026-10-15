/**
 * Unit tests for src/core/receipt.ts: amount, date and merchant from OCR text
 */
import { readReceiptText } from '../../src/core/receipt';

const TODAY = '2026-10-15';

describe('UPI screenshots', () => {
    test('Google Pay', () => {
        const text = [
            '10:32', 'To Swiggy', 'swiggy.payu@hdfcbank', '₹450', 'Completed', '14 Oct 2026, 10:31 pm',
            'UPI transaction ID', '428712345678', 'To: SWIGGY LIMITED', 'From: Ravi Kumar (HDFC Bank)', 'Google Pay',
        ].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'upi', amount: '450.00', date: '2026-10-14', merchant: 'Swiggy', readAs: null });
    });

    test('PhonePe, with the rupee sign read as "%"', () => {
        const text = [
            'Transaction Successful', '09:15 am on 12 Oct 2026', 'Paid to', 'BIG BAZAAR RETAIL', 'bigbazaar@ybl', '%1,250.50',
            'Transaction ID', 'T2610120915123456789', 'UTR: 428698765432', 'Debited from', 'XXXXXXXX4321', 'PhonePe',
        ].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'upi', amount: '1250.50', date: '2026-10-12', merchant: 'Big Bazaar Retail', readAs: null });
    });

    test('Paytm', () => {
        const text = ['Paid Successfully to', 'Sharma Kirana Store', 'Rs. 86', 'UPI Ref No: 428600011122', '13 Oct 2026, 08:05 AM', 'paytm'].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'upi', amount: '86.00', date: '2026-10-13', merchant: 'Sharma Kirana Store', readAs: null });
    });
});

describe('the rupee sign as OCR reads it', () => {
    test('a UPI amount with a leading 3 and no sign: the 3 was the sign, and the number as read is kept', () => {
        const reading = readReceiptText('To Swiggy\n3450\nCompleted\nGoogle Pay', TODAY);
        expect(reading).toMatchObject({ amount: '450.00', readAs: '3450.00' });
        expect(readReceiptText('Paid to\nShop\n31,250.50\nPhonePe', TODAY)).toMatchObject({ amount: '1250.50', readAs: '31250.50' });
    });

    test('a sign that was read (or written) stays the sign; other first digits are the amount', () => {
        expect(readReceiptText('To Swiggy\n%3450\nGoogle Pay', TODAY)).toMatchObject({ amount: '3450.00', readAs: null });
        expect(readReceiptText('To Swiggy\n¥86\nGoogle Pay', TODAY)).toMatchObject({ amount: '86.00', readAs: null });
        expect(readReceiptText('To Swiggy\n450\nGoogle Pay', TODAY)).toMatchObject({ amount: '450.00', readAs: null });
        expect(readReceiptText('Shop\nTotal ¥ 2,345.60', TODAY)).toMatchObject({ amount: '2345.60', readAs: null });
    });
});

describe('receipts', () => {
    test('a restaurant bill: the grand total, not the subtotal or the taxes', () => {
        const text = [
            'THE BIRYANI HOUSE', '12, MG Road, Bengaluru 560001', 'GSTIN: 29ABCDE1234F1Z5', 'Ph: 080-41234567', 'TAX INVOICE',
            'Bill No: 4521   Date: 14/10/2026', 'Chicken Biryani  2  560.00', 'Raita  1  60.00', 'Sub Total  620.00',
            'CGST 2.5%  15.50', 'SGST 2.5%  15.50', 'Round Off  -0.00', 'Grand Total  651.00', 'Thank you! Visit again',
        ].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'receipt', amount: '651.00', date: '2026-10-14', merchant: 'The Biryani House', readAs: null });
    });

    test('a supermarket bill: the net amount, not the item count or savings', () => {
        const text = [
            'Avenue Supermarts Ltd', 'DMart Whitefield', 'Cash Memo', 'Date: 10-10-26  Time: 18:42', 'Total Qty: 14', 'Total Savings: 212.40',
            'NET AMOUNT', '2,345.60', 'Card  2,345.60', 'Tendered 2,345.60',
        ].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'receipt', amount: '2345.60', date: '2026-10-10', merchant: 'Avenue Supermarts Ltd', readAs: null });
    });

    test('a fuel slip with an amount line and a short date', () => {
        const text = ['WELCOME', 'HP PETROL PUMP', 'KORAMANGALA', 'Date : 15/10/26', 'Rate : 102.86', 'Volume : 19.44 L', 'Amount Paid : 2000.00', 'Vehicle No: KA01AB1234'].join('\n');
        expect(readReceiptText(text, TODAY)).toEqual({ kind: 'receipt', amount: '2000.00', date: '2026-10-15', merchant: 'Hp Petrol Pump', readAs: null });
    });

    test('without a total line: the largest marked amount', () => {
        expect(readReceiptText('Chai Point\nMasala chai Rs 40.00\nSamosa Rs 30.00\n70.00', TODAY).amount).toBe('70.00');
    });
});

describe('what is not an amount or a date', () => {
    test('phone, reference, card and GST numbers are never the amount', () => {
        const text = 'Shop\nPh 9876543210\nRef 428600011122\nCard XXXX1234\nGSTIN29ABCDE1234F1Z5\nTotal 99.00';
        expect(readReceiptText(text, TODAY).amount).toBe('99.00');
    });

    test('dates in the future or long ago are not the payment date', () => {
        expect(readReceiptText('Shop\nValid till 31/12/2027\nDate 01/10/2026\nTotal 10.00', TODAY).date).toBe('2026-10-01');
        expect(readReceiptText('Shop\nEst. 12/03/1998\nTotal 10.00', TODAY).date).toBeNull();
    });

    test('nothing readable', () => {
        expect(readReceiptText('', TODAY)).toEqual({ kind: 'receipt', amount: null, date: null, merchant: null, readAs: null });
        expect(readReceiptText('|||  ~~ \n ..', TODAY)).toEqual({ kind: 'receipt', amount: null, date: null, merchant: null, readAs: null });
    });
});

describe('the reader\'s files', () => {
    test('OCR_VERSION is the installed tesseract.js, whose files scripts/copy-ocr-assets.js copies', async () => {
        const { OCR_VERSION } = await import('../../lib/receipt-reader');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(OCR_VERSION).toBe(require('../../node_modules/tesseract.js/package.json').version);
    });
});

/**
 * Unit tests for src/core/sms.ts: reading the common Indian bank SMS formats
 */
import { readSms } from '../../src/core/sms';

test('a UPI debit with a VPA', () => {
    expect(readSms('Rs.450.00 debited from A/c XX1234 on 05-11-26 to VPA swiggy@icici (UPI Ref No 412345678901). Not you? Call 18002586161 -HDFC Bank'))
        .toEqual({ amount: '450.00', kind: 'expense', date: '2026-11-05', merchant: 'swiggy', last4: '1234' });
});

test('a card purchase, ignoring the available limit', () => {
    expect(readSms('INR 2,000.00 spent on HDFC Bank Card x9876 at AMAZON PAY on 2026-11-04:10:22:33. Avl Lmt: INR 48,000.00'))
        .toEqual({ amount: '2000.00', kind: 'expense', date: '2026-11-04', merchant: 'AMAZON PAY', last4: '9876' });
});

test('a salary credit, ignoring the balance', () => {
    expect(readSms('Dear Customer, Acct XX5678 is credited with Rs 52,000.00 on 01-Nov-26 from ACME TECH PVT LTD. Avl Bal Rs 1,02,345.50'))
        .toEqual({ amount: '52000.00', kind: 'income', date: '2026-11-01', merchant: 'ACME TECH PVT LTD', last4: '5678' });
});

test('ICICI style: the payee named before "credited"', () => {
    expect(readSms('ICICI Bank Acct XX123 debited for Rs 299.00 on 03-Nov-26; NETFLIX credited. UPI:412345678901. Call 18002662 for dispute.'))
        .toMatchObject({ amount: '299.00', kind: 'expense', date: '2026-11-03', merchant: 'NETFLIX', last4: '123' });
});

test('an amount with the rupee sign, and a transfer to a person', () => {
    expect(readSms('Sent ₹1,200 from your a/c ending 4321 to Rahul Sharma on 02/11/2026. Ref 1234.'))
        .toMatchObject({ amount: '1200.00', kind: 'expense', date: '2026-11-02', merchant: 'Rahul Sharma', last4: '4321' });
});

test('a message that is not a transaction', () => {
    expect(readSms('Your OTP for login is 482910. Do not share it with anyone.')).toEqual({ amount: null, kind: null, date: null, merchant: null, last4: null });
});

-- 0010: wallets, meal cards, bank details and transfers (v2 Phase 1, docs/ledger.md).
--
-- Wallets (prepaid and UPI wallets) and meal cards (Pluxee and similar employer food cards) are
-- money accounts that live only in the ledger. A bank account records its bank, account type and
-- savings interest rate. A transfer is an entry between two of the user's money accounts (an ATM
-- withdrawal, a card bill payment): it changes balances but is neither income nor spending.

alter table ledger_accounts drop constraint if exists ledger_accounts_subtype_check;
alter table ledger_accounts add constraint ledger_accounts_subtype_check check (subtype in (
    'bank', 'cash', 'credit_card', 'wallet', 'meal_card',
    'income', 'expense', 'opening_balance', 'adjustment'
));

-- The bank or provider (HDFC Bank, Paytm, Pluxee), free text
alter table ledger_accounts add column if not exists institution text check (length(institution) <= 100);
-- Bank accounts only
alter table ledger_accounts add column if not exists account_type text
    check (account_type in ('savings', 'current', 'salary', 'nre', 'nro'));
-- Savings interest, percent a year, e.g. 3.250
alter table ledger_accounts add column if not exists interest_rate numeric(6, 3)
    check (interest_rate >= 0 and interest_rate <= 100);
-- Anything else worth remembering: where a meal card works, when its balance expires
alter table ledger_accounts add column if not exists notes text check (length(notes) <= 500);

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer'
));

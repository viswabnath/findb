-- 0031: credit card statements (v2 Phase 4, lib/services/cards.ts, src/core/cards.ts).
--
-- A card's billing and due days sit on its ledger account, beside its interest rate (% a year,
-- the existing interest_rate column). Each statement is worked out from the ledger on its date;
-- one recorded here keeps the bank's own figures (the amount and the minimum due), and any interest
-- and fees on it are an entry on the card, spending in "Loan interest and fees". Payments are
-- matched to a statement by date: money into the card after the statement date.

alter table ledger_accounts add column if not exists billing_day smallint check (billing_day between 1 and 31);
alter table ledger_accounts add column if not exists due_day smallint check (due_day between 1 and 31);

create table card_statements (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    statement_date date not null,
    due_on date not null check (due_on > statement_date),
    amount_due_paise bigint not null check (amount_due_paise >= 0),
    minimum_due_paise bigint not null check (minimum_due_paise >= 0 and minimum_due_paise <= amount_due_paise),
    interest_paise bigint not null default 0 check (interest_paise >= 0),
    fees_paise bigint not null default 0 check (fees_paise >= 0),
    -- The entry that put the interest and fees on the card
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id)
);
create unique index card_statements_date on card_statements (account_id, statement_date) where deleted_at is null;

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement',
    'person_loan', 'person_repayment', 'person_settlement', 'shared_expense', 'group_settlement', 'loan', 'chit',
    'card_charges'
));

alter table card_statements enable row level security;
create policy own_rows on card_statements for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on card_statements to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on card_statements from anon, authenticated;
    end if;
end $$;

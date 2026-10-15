-- 0025: people and money with them (v2 Phase 3, lib/services/people.ts).
--
-- A person is a name in the user's list (they need no FinDB account). Each has one ledger account
-- (subtype 'person', an asset): positive while they owe the user, negative while the user owes
-- them. Lending, borrowing and repayments are movements between it and the user's money accounts,
-- never income or spending; only interest is income or spending. Each loan is a person_loans row,
-- and its entries carry person_loan_id (the repayments are those entries: their lines hold the
-- principal and interest parts).

create table people (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 80),
    notes text check (length(notes) <= 500),
    account_id bigint not null,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id)
);
create unique index people_user_name on people (user_id, lower(name)) where archived_at is null;

create table person_loans (
    id bigint generated always as identity primary key,
    user_id integer not null,
    person_id bigint not null,
    direction text not null check (direction in ('lent', 'borrowed')),
    principal_paise bigint not null check (principal_paise > 0),
    started_on date not null,
    due_on date,
    -- % a year, simple interest; null for interest-free
    interest_rate numeric(6, 3) check (interest_rate > 0 and interest_rate <= 100),
    notes text check (length(notes) <= 500),
    -- Settled by the user before everything came back (the rest recorded as a gift)
    closed_at timestamptz,
    -- Removed: its entries are voided
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check (due_on is null or due_on >= started_on),
    foreign key (user_id, person_id) references people (user_id, id) on delete cascade
);
create index person_loans_person on person_loans (user_id, person_id) where deleted_at is null;

alter table ledger_accounts drop constraint if exists ledger_accounts_subtype_check;
alter table ledger_accounts add constraint ledger_accounts_subtype_check check (subtype in (
    'bank', 'cash', 'credit_card', 'wallet', 'meal_card', 'receivable', 'person',
    'income', 'expense', 'opening_balance', 'adjustment'
));

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement',
    'person_loan', 'person_repayment', 'person_settlement'
));

alter table journal_entries add column if not exists person_loan_id bigint;
alter table journal_entries add constraint journal_entries_person_loan_fkey
    foreign key (user_id, person_loan_id) references person_loans (user_id, id) on delete set null (person_loan_id);
create index journal_entries_person_loan on journal_entries (user_id, person_loan_id) where person_loan_id is not null;

alter table people enable row level security;
alter table person_loans enable row level security;
create policy own_rows on people for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on person_loans for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on people, person_loans to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on people, person_loans from anon, authenticated;
    end if;
end $$;

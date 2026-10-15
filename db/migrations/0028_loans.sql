-- 0028: loans from banks and lenders (v2 Phase 3, lib/services/loans.ts, src/core/loans.ts).
--
-- A loan is a ledger account (subtype 'loan', a liability): negative while money is owed. The
-- money received comes into a money account; an EMI's principal reduces the loan and its interest
-- is spending ("Loan interest and fees"), as are fees. A loan already running when it is added
-- starts from what is owed now (an opening balance). The terms are kept for the schedule; rate
-- changes and every payment are kept to recalculate it and to answer "how much interest did I pay
-- this year?".

create table loans (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    name text not null check (length(name) between 1 and 80),
    lender text check (length(lender) <= 100),
    loan_kind text not null check (loan_kind in ('home', 'vehicle', 'personal', 'education', 'business', 'consumer', 'other')),
    rate_type text not null check (rate_type in ('reducing', 'flat')),
    rate_kind text not null check (rate_kind in ('fixed', 'floating')),
    principal_paise bigint not null check (principal_paise > 0),
    -- % a year at the start; later changes are in loan_rate_changes
    yearly_rate numeric(6, 3) not null check (yearly_rate >= 0 and yearly_rate <= 100),
    months integer not null check (months between 1 and 480),
    disbursed_on date not null,
    first_due date not null,
    -- EMIs due from this date are expected in FinDB: the first due date for a new loan, the day an
    -- existing loan was added (earlier EMIs were paid before FinDB)
    tracked_from date not null,
    -- The EMI as the lender set it (it may differ from the calculated one by a few rupees)
    emi_paise bigint not null check (emi_paise > 0),
    processing_fee_paise bigint not null default 0 check (processing_fee_paise >= 0),
    other_charges_paise bigint not null default 0 check (other_charges_paise >= 0),
    -- % of the balance charged to close early
    foreclosure_charge numeric(5, 2) not null default 0 check (foreclosure_charge >= 0 and foreclosure_charge <= 10),
    notes text check (length(notes) <= 500),
    closed_on date,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check (first_due >= disbursed_on),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade
);
create index loans_user on loans (user_id) where deleted_at is null;

create table loan_rate_changes (
    id bigint generated always as identity primary key,
    user_id integer not null,
    loan_id bigint not null,
    effective_from date not null,
    yearly_rate numeric(6, 3) not null check (yearly_rate >= 0 and yearly_rate <= 100),
    -- What the lender changed: the EMI (tenure kept) or the tenure (EMI kept)
    keep text not null check (keep in ('tenure', 'emi')),
    created_at timestamptz not null default now(),
    foreign key (user_id, loan_id) references loans (user_id, id) on delete cascade
);

create table loan_payments (
    id bigint generated always as identity primary key,
    user_id integer not null,
    loan_id bigint not null,
    kind text not null check (kind in ('emi', 'prepayment', 'topup', 'fee', 'opening', 'disbursal', 'closure')),
    paid_on date not null,
    principal_paise bigint not null default 0,
    interest_paise bigint not null default 0 check (interest_paise >= 0),
    charges_paise bigint not null default 0 check (charges_paise >= 0),
    -- What stays the same after a prepayment or top-up: the EMI (the loan ends sooner or later) or the tenure (the EMI changes)
    keep text check (keep in ('tenure', 'emi')),
    -- EMIs: paid in full, in part, or after the due date
    status text check (status in ('full', 'partial', 'late')),
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, loan_id) references loans (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id)
);
create index loan_payments_loan on loan_payments (user_id, loan_id) where deleted_at is null;

alter table ledger_accounts drop constraint if exists ledger_accounts_subtype_check;
alter table ledger_accounts add constraint ledger_accounts_subtype_check check (subtype in (
    'bank', 'cash', 'credit_card', 'wallet', 'meal_card', 'receivable', 'person', 'loan',
    'income', 'expense', 'opening_balance', 'adjustment'
));

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement',
    'person_loan', 'person_repayment', 'person_settlement', 'shared_expense', 'group_settlement', 'loan'
));

alter table loans enable row level security;
alter table loan_rate_changes enable row level security;
alter table loan_payments enable row level security;
create policy own_rows on loans for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on loan_rate_changes for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on loan_payments for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on loans, loan_rate_changes, loan_payments to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on loans, loan_rate_changes, loan_payments from anon, authenticated;
    end if;
end $$;

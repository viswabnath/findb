-- 0030: chit funds (v2 Phase 3, lib/services/chits.ts, src/core/chit.ts).
--
-- Each chit is a ledger account (subtype 'chit'). Before the user wins it, what they pay in is
-- savings held in the chit (an asset, not spending): each month the contribution goes in, less
-- the month's dividend, which is income. When they win, the net prize comes into their account
-- and the contributions still to pay become what they owe (the account goes negative, like a
-- loan); the discount and deductions they gave up are spending, the cost of taking the money
-- early. Auctions others win are recorded too: they set the month's dividend.

create table chit_funds (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    name text not null check (length(name) between 1 and 80),
    organiser_kind text not null check (organiser_kind in ('registered', 'informal')),
    organiser text check (length(organiser) <= 100),
    registration text check (length(registration) <= 100),
    value_paise bigint not null check (value_paise > 0),
    members integer not null check (members between 2 and 200),
    months integer not null check (months between 2 and 200),
    contribution_paise bigint not null check (contribution_paise > 0),
    commission_percent numeric(5, 2) not null default 5 check (commission_percent >= 0 and commission_percent <= 10),
    -- The first month's payment date; later months fall on the same day
    started_on date not null,
    -- Day of the month the auction is held (for the reminder), if known
    auction_day smallint check (auction_day between 1 and 31),
    notes text check (length(notes) <= 500),
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade
);

create table chit_instalments (
    id bigint generated always as identity primary key,
    user_id integer not null,
    chit_id bigint not null,
    month integer not null check (month >= 1),
    paid_on date not null,
    contribution_paise bigint not null check (contribution_paise > 0),
    dividend_paise bigint not null default 0 check (dividend_paise >= 0),
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, chit_id) references chit_funds (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id)
);
create unique index chit_instalments_month on chit_instalments (chit_id, month) where deleted_at is null;

create table chit_auctions (
    id bigint generated always as identity primary key,
    user_id integer not null,
    chit_id bigint not null,
    month integer not null check (month >= 1),
    held_on date not null,
    -- The winning bid: the discount the winner gave up
    discount_paise bigint not null check (discount_paise >= 0),
    -- The user won it: their deductions and the entry that brought the prize in
    won_by_user boolean not null default false,
    deductions_paise bigint not null default 0 check (deductions_paise >= 0),
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, chit_id) references chit_funds (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id)
);
create unique index chit_auctions_month on chit_auctions (chit_id, month) where deleted_at is null;
-- A member wins a chit once
create unique index chit_auctions_won_once on chit_auctions (chit_id) where won_by_user and deleted_at is null;

alter table ledger_accounts drop constraint if exists ledger_accounts_subtype_check;
alter table ledger_accounts add constraint ledger_accounts_subtype_check check (subtype in (
    'bank', 'cash', 'credit_card', 'wallet', 'meal_card', 'receivable', 'person', 'loan', 'chit',
    'income', 'expense', 'opening_balance', 'adjustment'
));

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement',
    'person_loan', 'person_repayment', 'person_settlement', 'shared_expense', 'group_settlement', 'loan', 'chit'
));

alter table chit_funds enable row level security;
alter table chit_instalments enable row level security;
alter table chit_auctions enable row level security;
create policy own_rows on chit_funds for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on chit_instalments for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on chit_auctions for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on chit_funds, chit_instalments, chit_auctions to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on chit_funds, chit_instalments, chit_auctions from anon, authenticated;
    end if;
end $$;

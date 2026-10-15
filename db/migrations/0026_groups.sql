-- 0026: shared expenses and groups (v2 Phase 3, lib/services/groups.ts, src/core/split.ts).
--
-- A group (a trip, a flat) lists people from the user's list; the user is always in it. Each
-- shared expense records who paid (the user, or a person) and each member's share. In the user's
-- books only their part shows (one entry per expense, linked here):
--   - the user paid: the whole amount leaves their account; their share is spending, and each
--     friend's share is owed to the user (the friend's person account);
--   - a friend paid: the user's share is spending, owed to that friend; no money moves;
--   - the user is not part of it and did not pay: no entry, only the group's balances.
-- Settlements between the user and a friend move real money; between two friends they are
-- recorded for the group's balances only.

create table groups (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 80),
    -- The event the user's shares are counted towards (a trip)
    event_id bigint,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, event_id) references events (user_id, id) on delete set null (event_id)
);
create unique index groups_user_name on groups (user_id, lower(name)) where archived_at is null;

create table group_members (
    user_id integer not null,
    group_id bigint not null,
    person_id bigint not null,
    primary key (group_id, person_id),
    foreign key (user_id, group_id) references groups (user_id, id) on delete cascade,
    foreign key (user_id, person_id) references people (user_id, id) on delete cascade
);

create table shared_expenses (
    id bigint generated always as identity primary key,
    user_id integer not null,
    group_id bigint not null,
    expense_date date not null,
    description text not null check (length(description) between 1 and 200),
    amount_paise bigint not null check (amount_paise > 0),
    -- Who paid it all: null is the user
    paid_by_person_id bigint,
    split_method text not null check (split_method in ('equal', 'exact', 'percent', 'shares')),
    -- The category of the user's share, and of the expense in the group's breakdown
    category_id bigint,
    -- The user's entry for their part; null when they neither paid nor shared it
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, group_id) references groups (user_id, id) on delete cascade,
    foreign key (user_id, paid_by_person_id) references people (user_id, id),
    foreign key (user_id, category_id) references ledger_accounts (user_id, id),
    foreign key (user_id, entry_id) references journal_entries (user_id, id)
);
create index shared_expenses_group on shared_expenses (user_id, group_id) where deleted_at is null;

create table shared_expense_shares (
    id bigint generated always as identity primary key,
    user_id integer not null,
    expense_id bigint not null,
    -- null is the user
    person_id bigint,
    share_paise bigint not null check (share_paise >= 0),
    -- As entered: paise (exact), hundredths of a percent (percent), shares (shares); null for equal
    entered integer,
    foreign key (user_id, expense_id) references shared_expenses (user_id, id) on delete cascade,
    foreign key (user_id, person_id) references people (user_id, id)
);
create unique index shared_expense_shares_once on shared_expense_shares (expense_id, coalesce(person_id, 0));

create table settlements (
    id bigint generated always as identity primary key,
    user_id integer not null,
    group_id bigint not null,
    -- null is the user
    from_person_id bigint,
    to_person_id bigint,
    amount_paise bigint not null check (amount_paise > 0),
    settled_on date not null,
    -- The money that moved, when the user paid or was paid
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check (from_person_id is distinct from to_person_id),
    foreign key (user_id, group_id) references groups (user_id, id) on delete cascade,
    foreign key (user_id, from_person_id) references people (user_id, id),
    foreign key (user_id, to_person_id) references people (user_id, id),
    foreign key (user_id, entry_id) references journal_entries (user_id, id)
);
create index settlements_group on settlements (user_id, group_id) where deleted_at is null;

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement',
    'person_loan', 'person_repayment', 'person_settlement', 'shared_expense', 'group_settlement'
));

alter table groups enable row level security;
alter table group_members enable row level security;
alter table shared_expenses enable row level security;
alter table shared_expense_shares enable row level security;
alter table settlements enable row level security;
create policy own_rows on groups for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on group_members for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on shared_expenses for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on shared_expense_shares for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on settlements for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on groups, group_members, shared_expenses, shared_expense_shares, settlements to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on groups, group_members, shared_expenses, shared_expense_shares, settlements from anon, authenticated;
    end if;
end $$;

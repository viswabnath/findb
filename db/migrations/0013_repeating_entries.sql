-- 0013: repeating entries (v2 Phase 1, docs/ledger.md).
--
-- Salary, rent, EMIs, SIPs, subscriptions: an entry that repeats daily, weekly, monthly or yearly
-- (src/core/schedule.ts). Each is either recorded automatically when it falls due, or waits for
-- the user to confirm it (with the amount, which may differ, such as an electricity bill). Due
-- entries are processed when the user opens FinDB. Every entry made from one remembers it and the
-- date it was for, and the same date can only be recorded once.

create table recurring_entries (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    entry_type text not null check (entry_type in ('income', 'expense', 'transfer')),
    description text not null check (length(description) between 1 and 200),
    amount_paise bigint not null check (amount_paise > 0),
    account_id bigint not null,
    to_account_id bigint,
    category_id bigint,
    event_id bigint,
    tags text[] not null default '{}',
    frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
    day_of_week smallint check (day_of_week between 0 and 6),
    day_of_month smallint check (day_of_month between 1 and 31),
    month smallint check (month between 1 and 12),
    starts_on date not null,
    ends_on date,
    -- The next date it falls due; null once it has ended
    next_due date,
    mode text not null default 'confirm' check (mode in ('auto', 'confirm')),
    -- Show it this many days before it is due
    remind_days smallint not null default 3 check (remind_days between 0 and 30),
    paused_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check ((entry_type = 'transfer') = (to_account_id is not null)),
    check (ends_on is null or ends_on >= starts_on),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id),
    foreign key (user_id, to_account_id) references ledger_accounts (user_id, id),
    foreign key (user_id, category_id) references ledger_accounts (user_id, id),
    foreign key (user_id, event_id) references events (user_id, id) on delete set null (event_id)
);
create index recurring_entries_due on recurring_entries (user_id, next_due) where next_due is not null and paused_at is null;

alter table journal_entries add column if not exists recurring_id bigint;
alter table journal_entries add column if not exists recurring_on date;
alter table journal_entries add constraint journal_entries_recurring_fkey
    foreign key (user_id, recurring_id) references recurring_entries (user_id, id) on delete set null (recurring_id);
-- One entry per repeating entry and date (a voided one does not count, so it can be recorded again)
create unique index journal_entries_recurring_once on journal_entries (recurring_id, recurring_on)
    where recurring_id is not null and voided_at is null;

alter table recurring_entries enable row level security;
create policy own_rows on recurring_entries for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on recurring_entries to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on recurring_entries from anon, authenticated;
    end if;
end $$;

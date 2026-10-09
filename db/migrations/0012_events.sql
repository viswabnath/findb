-- 0012: events and projects, the purpose of an entry (v2 Phase 1, docs/ledger.md).
--
-- An event is a named purpose with optional dates and an optional budget: "Sister's wedding",
-- "House construction", "Goa trip". Any income, expense or transfer can carry one, alongside its
-- category. A one-off event (the default) can be left out of regular spending, so a wedding does
-- not distort the monthly averages.

create table events (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 80),
    starts_on date,
    ends_on date,
    budget_paise bigint check (budget_paise >= 0),
    one_off boolean not null default true,
    notes text check (length(notes) <= 500),
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index events_user_name on events (user_id, lower(name)) where archived_at is null;

alter table journal_entries add column if not exists event_id bigint;
alter table journal_entries add constraint journal_entries_event_fkey
    foreign key (user_id, event_id) references events (user_id, id) on delete set null (event_id);
create index journal_entries_event on journal_entries (user_id, event_id) where event_id is not null;

alter table events enable row level security;
create policy own_rows on events for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on events to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on events from anon, authenticated;
    end if;
end $$;

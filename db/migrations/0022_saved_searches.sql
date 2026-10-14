-- 0022: saved searches (v2 Phase 2, lib/services/search.ts).
--
-- A search the user runs often ("Swiggy this year", "Goa trip over ₹1,000") is kept by name: the
-- filters only (text, dates, amounts, type, account, category, tag, event), never results.

create table saved_searches (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 60),
    filters jsonb not null check (jsonb_typeof(filters) = 'object' and length(filters::text) <= 1000),
    created_at timestamptz not null default now(),
    unique (user_id, id)
);
create unique index saved_searches_user_name on saved_searches (user_id, lower(name));

alter table saved_searches enable row level security;
create policy own_rows on saved_searches for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on saved_searches to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on saved_searches from anon, authenticated;
    end if;
end $$;

-- 0023: budgets (v2 Phase 2, lib/services/budgets.ts).
--
-- A monthly limit for a spending category. Spending against it is the category's expense lines in
-- the month, from the ledger; nothing is stored per month. Alerts show at 80% and 100%.

create table budgets (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    category_id bigint not null,
    amount_paise bigint not null check (amount_paise > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    unique (user_id, category_id),
    foreign key (user_id, category_id) references ledger_accounts (user_id, id) on delete cascade
);

alter table budgets enable row level security;
create policy own_rows on budgets for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on budgets to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on budgets from anon, authenticated;
    end if;
end $$;

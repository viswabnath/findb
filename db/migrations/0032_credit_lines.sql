-- 0032: credit lines (v2 Phase 4, lib/services/credit-lines.ts).
--
-- Some banks give one limit shared by several cards (a primary card and an add-on, or two cards
-- from the same bank). A credit line holds that limit; each card on it keeps its own limit too,
-- and the room left on a card is the smaller of what is left on its own limit and on the line.

create table credit_lines (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 80),
    limit_paise bigint not null check (limit_paise > 0),
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id)
);

alter table ledger_accounts add column if not exists credit_line_id bigint;
alter table ledger_accounts add constraint ledger_accounts_credit_line_fk
    foreign key (user_id, credit_line_id) references credit_lines (user_id, id) on delete set null (credit_line_id);
create index if not exists ledger_accounts_credit_line on ledger_accounts (credit_line_id) where credit_line_id is not null;

alter table credit_lines enable row level security;
create policy own_rows on credit_lines for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on credit_lines to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on credit_lines from anon, authenticated;
    end if;
end $$;

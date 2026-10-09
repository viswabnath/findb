-- 0015: reconciliation (v2 Phase 1, docs/ledger.md).
--
-- The user checks an account against a statement: the balance it shows on a date, and which of
-- FinDB's entries appear on it. Each line ticked off records the reconciliation that cleared it;
-- the difference left is the statement balance less the cleared lines. A finished reconciliation
-- protects its lines: changing one warns first.

create table reconciliations (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    statement_date date not null,
    -- As the statement shows it: money in the account, or for a card, the amount owed
    statement_balance_paise bigint not null,
    status text not null default 'open' check (status in ('open', 'done')),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (user_id, id),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id)
);
-- At most one open reconciliation per account
create unique index reconciliations_one_open on reconciliations (user_id, account_id) where status = 'open';

alter table journal_lines add column if not exists reconciliation_id bigint;
alter table journal_lines add constraint journal_lines_reconciliation_fkey
    foreign key (user_id, reconciliation_id) references reconciliations (user_id, id) on delete set null (reconciliation_id);
create index journal_lines_reconciliation on journal_lines (user_id, reconciliation_id) where reconciliation_id is not null;

alter table reconciliations enable row level security;
create policy own_rows on reconciliations for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on reconciliations to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on reconciliations from anon, authenticated;
    end if;
end $$;

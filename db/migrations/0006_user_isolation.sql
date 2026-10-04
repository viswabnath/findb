-- 0006: the database itself keeps each user to their own rows (v2 Phase 1, docs/security.md).
--
-- A logged-in request runs as the role findb_user, in one transaction with app.user_id set to the
-- user (withUserScope in lib/transaction.ts). findb_user owns nothing and does not bypass row
-- level security, so the policies below apply: every query sees and changes only rows of that
-- user, even a query that forgot its own user_id filter. With app.user_id unset it sees nothing.
--
-- The app's login (the tables' owner) is unaffected: owners skip row level security unless it is
-- forced. It still runs login, registration, recovery and the session check, which must find an
-- account before knowing who is asking, and the migrations and scripts.
--
-- findb_user must exist first, made once by an administrator (it has no login and no password):
--     create role findb_user nologin;
--     grant findb_user to <the app's login>;   -- findb_app in production, findb_test_app in tests

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'findb_user') then
        raise exception 'Role findb_user is missing. As an administrator run: create role findb_user nologin; grant findb_user to %;', current_user;
    end if;
    if not pg_has_role(current_user, 'findb_user', 'MEMBER') then
        raise exception 'The app login % cannot switch to findb_user. As an administrator run: grant findb_user to %;', current_user, current_user;
    end if;
    execute format('grant usage on schema %I to findb_user', current_schema());
    execute format('grant usage, select on all sequences in schema %I to findb_user', current_schema());
    -- Tables and sequences added later get the same rights; each still needs its own policy, and
    -- without one findb_user sees none of its rows (row level security is on for every table)
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to findb_user', current_schema());
    execute format('alter default privileges in schema %I grant usage, select on sequences to findb_user', current_schema());
end $$;

grant select, insert, update, delete on
    users, banks, credit_cards, income_entries, expenses, cash_balance, activity_log, session,
    ledger_accounts, journal_entries, journal_lines, recovery_codes, login_events
to findb_user;
grant select on ledger_account_balances, ledger_balance_check to findb_user;

-- The user the request is for, or null outside one (then no row matches)
create function app_user_id() returns integer
language sql stable
set search_path from current
as $$ select nullif(current_setting('app.user_id', true), '')::integer $$;
grant execute on function app_user_id() to findb_user;

create policy own_rows on users for all to findb_user
    using (id = app_user_id()) with check (id = app_user_id());

create policy own_rows on banks for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on credit_cards for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on income_entries for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on expenses for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on cash_balance for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on activity_log for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on ledger_accounts for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on journal_entries for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on journal_lines for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on recovery_codes for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on login_events for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());

-- Sessions from before 0005 have no user_id column value, only sess.userId
create policy own_rows on session for all to findb_user
    using (user_id = app_user_id() or (sess ->> 'userId') = app_user_id()::text)
    with check (user_id = app_user_id() or (sess ->> 'userId') = app_user_id()::text);

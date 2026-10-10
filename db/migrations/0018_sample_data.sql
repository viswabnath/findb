-- 0018: sample data to explore FinDB before entering your own (v2 Phase 1, lib/services/sample-data.ts).
--
-- Rows made by "Try with sample data" carry sample = true, and clearing it deletes exactly those
-- rows (sample data is not history, so it is removed rather than voided). The database keeps it
-- apart from real money, so no total ever mixes the two:
--   - while a user has sample accounts, no real entry can be recorded (clear the sample first);
--   - a journal line on a sample account must belong to a sample entry;
--   - a sample entry may touch no real bank, card, cash or other money account (categories and
--     opening balances are shared).
-- Anything else is refused with SQLSTATE FS001, whose message is shown to the user.

alter table ledger_accounts add column if not exists sample boolean not null default false;
alter table journal_entries add column if not exists sample boolean not null default false;
alter table banks add column if not exists sample boolean not null default false;
alter table credit_cards add column if not exists sample boolean not null default false;
alter table events add column if not exists sample boolean not null default false;
alter table tags add column if not exists sample boolean not null default false;

create index if not exists ledger_accounts_sample on ledger_accounts (user_id) where sample;
create index if not exists journal_entries_sample on journal_entries (user_id) where sample;

create function journal_lines_sample_check() returns trigger
language plpgsql
set search_path from current
as $$
declare
    entry_sample boolean;
    account_sample boolean;
    account_kind text;
begin
    select sample into entry_sample from journal_entries where id = new.entry_id;
    select sample, kind into account_sample, account_kind from ledger_accounts where id = new.account_id;
    if account_sample and not entry_sample then
        raise exception 'Sample accounts are only for looking around. Add your own account for real entries, or clear the sample data.'
            using errcode = 'FS001';
    end if;
    if entry_sample and not account_sample and account_kind in ('asset', 'liability') then
        raise exception 'Sample entries cannot use your own accounts' using errcode = 'FS001';
    end if;
    return new;
end;
$$;

create trigger journal_lines_sample
    before insert or update of account_id, entry_id on journal_lines
    for each row execute function journal_lines_sample_check();

create function journal_entries_sample_check() returns trigger
language plpgsql
set search_path from current
as $$
begin
    if not new.sample and exists (select 1 from ledger_accounts where user_id = new.user_id and sample) then
        raise exception 'You are looking at sample data. Clear it first (the button at the top), then add your own.'
            using errcode = 'FS001';
    end if;
    return new;
end;
$$;

create trigger journal_entries_sample
    before insert on journal_entries
    for each row execute function journal_entries_sample_check();

revoke all on function journal_lines_sample_check() from public;
revoke all on function journal_entries_sample_check() from public;
grant execute on function journal_lines_sample_check() to findb_user;
grant execute on function journal_entries_sample_check() to findb_user;

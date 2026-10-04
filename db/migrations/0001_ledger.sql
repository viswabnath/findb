-- 0001: the double-entry ledger (v2 Phase 1, docs/ledger.md).
--
-- Every money event is one journal entry made of lines. Each line moves an amount, in paise, into
-- (positive) or out of (negative) an account, and the lines of an entry always add up to zero.
-- Banks, cash and cards are accounts, and so are income, expenses and the equity accounts that
-- hold opening balances and adjustments.
--
-- Runs in the schema on the connection's search_path (public in production, balancetrack_test in
-- tests), so nothing here names a schema. Apply with scripts/migrate.js.

create table ledger_accounts (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    kind text not null check (kind in ('asset', 'liability', 'income', 'expense', 'equity')),
    subtype text not null check (subtype in ('bank', 'cash', 'credit_card', 'income', 'expense', 'opening_balance', 'adjustment')),
    name text not null,
    currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
    -- Credit cards only
    credit_limit_paise bigint check (credit_limit_paise is null or credit_limit_paise >= 0),
    -- One per user for the built-in accounts: cash, income, expense, opening_balance, adjustment
    system_key text,
    -- The row this account mirrors while the former tables remain: banks or credit_cards
    source_table text check (source_table in ('banks', 'credit_cards')),
    source_id integer,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    -- Lets journal lines reference (user_id, id), so a line can only use its own user's accounts
    unique (user_id, id),
    check ((source_table is null) = (source_id is null))
);

create unique index ledger_accounts_system_key on ledger_accounts (user_id, system_key) where system_key is not null;
create unique index ledger_accounts_source on ledger_accounts (source_table, source_id) where source_table is not null;

create table journal_entries (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    entry_date date not null default current_date,
    description text not null,
    entry_type text not null check (entry_type in ('opening_balance', 'income', 'expense', 'adjustment')),
    -- The row this entry records while the former tables remain
    source_table text check (source_table in ('banks', 'credit_cards', 'cash_balance', 'income_entries', 'expenses')),
    source_id integer,
    -- Corrections keep history: an edited or deleted entry is voided, not removed, and stops counting
    voided_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check ((source_table is null) = (source_id is null))
);

create index journal_entries_user_date on journal_entries (user_id, entry_date);
create index journal_entries_active_source on journal_entries (source_table, source_id) where voided_at is null;

create table journal_lines (
    id bigint generated always as identity primary key,
    user_id integer not null,
    entry_id bigint not null,
    account_id bigint not null,
    -- Positive moves money into the account (a debit), negative moves it out (a credit)
    amount_paise bigint not null check (amount_paise <> 0),
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete cascade,
    foreign key (user_id, account_id) references ledger_accounts (user_id, id)
);

create index journal_lines_entry on journal_lines (user_id, entry_id);
create index journal_lines_account on journal_lines (user_id, account_id);

-- Every entry has at least two lines and they add up to zero. Checked when the transaction
-- commits (deferred), so an entry and its lines can be written in any order within it.
create function journal_entry_must_balance(target_entry bigint) returns void
language plpgsql
set search_path from current
as $$
declare
    line_count integer;
    total bigint;
begin
    if not exists (select 1 from journal_entries where id = target_entry) then
        return;
    end if;
    select count(*), coalesce(sum(amount_paise), 0) into line_count, total from journal_lines where entry_id = target_entry;
    if line_count < 2 or total <> 0 then
        raise exception 'Journal entry % does not balance (% lines, total % paise)', target_entry, line_count, total
            using errcode = 'check_violation';
    end if;
end;
$$;

create function journal_lines_balance_check() returns trigger
language plpgsql
set search_path from current
as $$
begin
    if tg_op in ('UPDATE', 'DELETE') then
        perform journal_entry_must_balance(old.entry_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
        perform journal_entry_must_balance(new.entry_id);
    end if;
    return null;
end;
$$;

create function journal_entries_balance_check() returns trigger
language plpgsql
set search_path from current
as $$
begin
    perform journal_entry_must_balance(new.id);
    return null;
end;
$$;

create constraint trigger journal_lines_balanced
    after insert or update or delete on journal_lines
    deferrable initially deferred
    for each row execute function journal_lines_balance_check();

create constraint trigger journal_entries_balanced
    after insert on journal_entries
    deferrable initially deferred
    for each row execute function journal_entries_balance_check();

-- Each account's balance in paise, from the entries that still count
create view ledger_account_balances with (security_invoker = true) as
select l.account_id, l.user_id, sum(l.amount_paise)::bigint as balance_paise
from journal_lines l
join journal_entries e on e.id = l.entry_id
where e.voided_at is null
group by l.account_id, l.user_id;

-- While the former tables remain, every bank, card and cash balance stored there must equal the
-- ledger's. A row whose two balances differ is a bug; the tests and npm run ledger:check look here.
-- Card balances are liabilities, so the ledger holds the used amount as a negative balance.
create view ledger_balance_check with (security_invoker = true) as
select b.user_id, 'bank'::text as account_type, b.id as source_id, b.name as label, a.id as account_id,
       round(b.current_balance * 100)::bigint as target_balance_paise, coalesce(s.balance_paise, 0)::bigint as ledger_balance_paise
from banks b
left join ledger_accounts a on a.source_table = 'banks' and a.source_id = b.id
left join ledger_account_balances s on s.account_id = a.id
union all
select c.user_id, 'credit_card', c.id, c.name, a.id,
       -round(c.used_limit * 100)::bigint, coalesce(s.balance_paise, 0)::bigint
from credit_cards c
left join ledger_accounts a on a.source_table = 'credit_cards' and a.source_id = c.id
left join ledger_account_balances s on s.account_id = a.id
union all
select cb.user_id, 'cash', cb.id, 'Cash', a.id,
       round(cb.balance * 100)::bigint, coalesce(s.balance_paise, 0)::bigint
from cash_balance cb
left join ledger_accounts a on a.user_id = cb.user_id and a.system_key = 'cash'
left join ledger_account_balances s on s.account_id = a.id;

-- Like every other table: row level security on, with no policies, so Supabase's public Data API
-- can read nothing. The app connects as the tables' owner.
alter table ledger_accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;

-- The Data API roles exist only on Supabase; elsewhere there is nothing to revoke
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on ledger_accounts, journal_entries, journal_lines, ledger_account_balances, ledger_balance_check from anon, authenticated;
    end if;
end $$;

revoke all on function journal_entry_must_balance(bigint) from public;
revoke all on function journal_lines_balance_check() from public;
revoke all on function journal_entries_balance_check() from public;

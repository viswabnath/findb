-- 0020: statement import (v2 Phase 2, docs/ledger.md).
--
-- The user uploads a bank or card statement (CSV or Excel). The browser reads the file, so the file
-- itself never reaches FinDB: only the rows the user reviews and keeps. Two tables:
--   - import_profiles: the columns chosen for a statement layout (found by its headers), so the
--     same bank's next statement needs no choosing;
--   - import_batches: one row per import, with what it added; its entries carry import_batch_id,
--     so an import can be undone as a whole. Entries an import replaced (one side of a transfer
--     recorded earlier as spending or income) are listed, and come back when it is undone.

create table import_profiles (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    -- The layout's normalised headers in order (src/core/statement.ts layoutSignature)
    signature text not null check (length(signature) between 1 and 500),
    -- The known layout it is (hdfc_account...), if any
    preset_key text check (preset_key ~ '^[a-z_]{1,40}$'),
    -- Column indexes, date order and sign (src/core/statement.ts Mapping)
    mapping jsonb not null check (jsonb_typeof(mapping) = 'object' and length(mapping::text) <= 1000),
    -- The account its last statement went into
    account_id bigint,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    unique (user_id, id),
    unique (user_id, signature),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id)
);

create table import_batches (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    profile_id bigint,
    file_kind text not null check (file_kind in ('csv', 'excel')),
    -- What the review showed and what was kept
    rows_in_file integer not null check (rows_in_file >= 0),
    imported integer not null check (imported >= 0),
    statement_from date,
    statement_to date,
    -- The balance the statement ends with, if it shows one (a card's is what is owed, negative)
    closing_balance_paise bigint,
    -- Entries on another account that this import turned into transfers (voided while it stands)
    replaced_entry_ids bigint[] not null default '{}',
    created_at timestamptz not null default now(),
    undone_at timestamptz,
    unique (user_id, id),
    check (statement_to is null or statement_from is null or statement_to >= statement_from),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id),
    foreign key (user_id, profile_id) references import_profiles (user_id, id) on delete set null (profile_id)
);
create index import_batches_user on import_batches (user_id, created_at desc);

alter table journal_entries add column if not exists import_batch_id bigint;
alter table journal_entries add constraint journal_entries_import_batch_fkey
    foreign key (user_id, import_batch_id) references import_batches (user_id, id) on delete set null (import_batch_id);
create index journal_entries_import_batch on journal_entries (user_id, import_batch_id) where import_batch_id is not null;

alter table import_profiles enable row level security;
alter table import_batches enable row level security;
create policy own_rows on import_profiles for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on import_batches for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on import_profiles, import_batches to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on import_profiles, import_batches from anon, authenticated;
    end if;
end $$;

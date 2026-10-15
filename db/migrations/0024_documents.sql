-- 0024: the document vault (v2 Phase 2, lib/services/documents.ts).
--
-- Receipts, statements, invoices, policies, loan and property papers, warranties, certificates and
-- tax forms. The files are encrypted by FinDB and kept in a private Supabase Storage bucket
-- (lib/document-store.ts); this table holds what describes them. A document can be linked to any
-- number of entries, accounts and events.

create table documents (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    kind text not null check (kind in ('receipt', 'statement', 'invoice', 'policy', 'loan', 'property', 'warranty', 'certificate', 'tax', 'other')),
    title text not null check (length(title) between 1 and 120),
    document_date date,
    -- India's financial year, April to March: "2026-27"
    financial_year text check (financial_year ~ '^\d{4}-\d{2}$'),
    expires_on date,
    notes text check (length(notes) <= 500),
    file_name text not null check (length(file_name) between 1 and 120),
    mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    size_bytes integer not null check (size_bytes > 0 and size_bytes <= 2097152),
    -- In the bucket: <user id>/<random id>; the file is encrypted with the key version stored in it
    storage_path text not null unique,
    created_at timestamptz not null default now(),
    unique (user_id, id)
);
create index documents_user on documents (user_id, created_at desc);

create table document_links (
    id bigint generated always as identity primary key,
    user_id integer not null,
    document_id bigint not null,
    entry_id bigint,
    account_id bigint,
    event_id bigint,
    foreign key (user_id, document_id) references documents (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete cascade,
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade,
    foreign key (user_id, event_id) references events (user_id, id) on delete cascade,
    check (num_nonnulls(entry_id, account_id, event_id) = 1)
);
create unique index document_links_once on document_links (document_id, coalesce(entry_id, 0), coalesce(account_id, 0), coalesce(event_id, 0));
create index document_links_entry on document_links (user_id, entry_id) where entry_id is not null;

alter table documents enable row level security;
alter table document_links enable row level security;
create policy own_rows on documents for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on document_links for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on documents, document_links to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on documents, document_links from anon, authenticated;
    end if;
end $$;

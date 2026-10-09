-- 0016: the user's profile and dependants (v2 Phase 1, docs/privacy.md).
--
-- Date of birth (for age-based rules such as senior citizen interest), city, tax residency, and
-- dependants (spouse, children, parents) with their dates of birth, for insurance, goals and the
-- review. PAN and demat or broker account IDs are encrypted in the application before they reach
-- the database (lib/field-encryption.ts) and shown masked. Aadhaar: at most the last four digits,
-- never the full number, which the Aadhaar Act restricts.

create table profiles (
    user_id integer primary key references users (id) on delete cascade,
    date_of_birth date check (date_of_birth > '1900-01-01'),
    city text check (length(city) <= 80),
    tax_residency text check (tax_residency in ('resident', 'nri', 'rnor')),
    pan_enc text,
    aadhaar_last4 text check (aadhaar_last4 ~ '^[0-9]{4}$'),
    -- A JSON list of { broker, accountId }, encrypted as a whole
    demat_accounts_enc text,
    updated_at timestamptz not null default now()
);

create table dependants (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    relationship text not null check (relationship in ('spouse', 'child', 'parent', 'other')),
    name text not null check (length(name) between 1 and 80),
    date_of_birth date,
    created_at timestamptz not null default now()
);
create index dependants_user on dependants (user_id);

alter table profiles enable row level security;
alter table dependants enable row level security;
create policy own_rows on profiles for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on dependants for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on profiles, dependants to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on profiles, dependants from anon, authenticated;
    end if;
end $$;

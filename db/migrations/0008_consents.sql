-- 0008: consent to the privacy notice (India's DPDP Act, 2023; docs/privacy.md).
--
-- One row each time a user agrees to a version of the notice (lib/privacy-notice.ts): at sign-up,
-- or for an account from before the notice, at its next visit. Withdrawing sets withdrawn_at; the
-- row stays as the record that consent was given and when it ended.

create table consents (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    notice_version text not null,
    purpose text not null default 'provide_service' check (purpose in ('provide_service')),
    given_at timestamptz not null default now(),
    withdrawn_at timestamptz,
    user_agent text
);
create index consents_user on consents (user_id, given_at desc);

alter table consents enable row level security;
create policy own_rows on consents for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on consents to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on consents from anon, authenticated;
    end if;
end $$;

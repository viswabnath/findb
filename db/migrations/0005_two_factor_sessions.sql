-- 0005: two-factor login, the session list and login history (v2 Phase 1, docs/security.md).

-- Two-factor login with an authenticator app. Secrets are encrypted in the application
-- (lib/field-encryption.ts) before they are stored here.
alter table users add column if not exists totp_secret_enc text;
-- A secret being set up, until the first code from it is confirmed
alter table users add column if not exists totp_pending_secret_enc text;
alter table users add column if not exists totp_enabled_at timestamptz;
-- The 30-second step of the last code accepted, so a code cannot be used twice
alter table users add column if not exists totp_last_step bigint;

-- One-time recovery codes, for a lost phone. Only a hash of each is kept.
create table recovery_codes (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    code_hash text not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index recovery_codes_user on recovery_codes (user_id) where used_at is null;

-- Sessions, for the list of signed-in devices. Rows from before this migration have none of these
-- and expire within two hours.
alter table session add column if not exists user_id integer references users (id) on delete cascade;
alter table session add column if not exists created_at timestamptz not null default now();
alter table session add column if not exists last_seen_at timestamptz;
alter table session add column if not exists user_agent text;
create index if not exists session_user_id on session (user_id);

-- Sign-in events the user can review: successful logins, wrong passwords and codes, and security
-- changes. No IP addresses are kept; the browser and device come from the user agent.
create table login_events (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    event text not null check (event in (
        'signed_in', 'wrong_password', 'wrong_code', 'recovery_code_used', 'two_factor_enabled',
        'recovery_codes_created', 'signed_out_session', 'signed_out_everywhere', 'password_changed'
    )),
    user_agent text,
    created_at timestamptz not null default now()
);
create index login_events_user_time on login_events (user_id, created_at desc);

alter table recovery_codes enable row level security;
alter table login_events enable row level security;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on recovery_codes, login_events from anon, authenticated;
    end if;
end $$;

-- 0035: rate limits shared by every server instance (v2 Phase 5, lib/rate-limit.ts).
--
-- Writes and failed sign-in attempts are counted here, in fixed windows, so the limits hold
-- however many instances Vercel runs. Keys hold a user id or a hash of an IP address, never the
-- address itself. Old windows are deleted as new ones are counted. Only the server (the owner
-- login) reads and writes this table: no policies, nothing granted to findb_user.

create table rate_limits (
    key text not null check (length(key) <= 100),
    -- The window's start, in whole windows since 1970 (Date.now() / window length)
    window_start bigint not null,
    count integer not null default 1,
    updated_at timestamptz not null default now(),
    primary key (key, window_start)
);
create index rate_limits_updated on rate_limits (updated_at);

alter table rate_limits enable row level security;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on rate_limits from anon, authenticated;
    end if;
end $$;

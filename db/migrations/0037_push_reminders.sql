-- 0037: reminders by push notification (v2 Phase 5, lib/services/reminders.ts, lib/push.ts).
--
-- A browser or installed phone app that turns reminders on gives a push subscription: an address
-- at its push service and two keys to encrypt to it. The daily job (app/api/cron/reminders) sends
-- each user one notification about what is due today and tomorrow, and records the day, so a run
-- that repeats sends nothing twice. A subscription the push service says is gone is deleted.

create table push_subscriptions (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    endpoint text not null unique check (length(endpoint) <= 1000),
    p256dh text not null check (length(p256dh) <= 200),
    auth text not null check (length(auth) <= 100),
    -- Browser and device, for the list in Settings
    user_agent text check (length(user_agent) <= 300),
    created_at timestamptz not null default now(),
    last_sent_at timestamptz,
    unique (user_id, id)
);
create index push_subscriptions_user on push_subscriptions (user_id);

create table reminders_sent (
    user_id integer not null references users (id) on delete cascade,
    sent_on date not null,
    items integer not null default 0,
    created_at timestamptz not null default now(),
    primary key (user_id, sent_on)
);

alter table push_subscriptions enable row level security;
alter table reminders_sent enable row level security;
create policy own_rows on push_subscriptions for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on reminders_sent for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on push_subscriptions, reminders_sent to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on push_subscriptions, reminders_sent from anon, authenticated;
    end if;
end $$;

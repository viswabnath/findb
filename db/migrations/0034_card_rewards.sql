-- 0034: card rewards (v2 Phase 4, lib/services/rewards.ts, src/core/rewards.ts).
--
-- Reward points earned, redeemed and expired on each card, and cashback credited to the card or to
-- a bank for a card. Cashback, and points redeemed for money, are income in "Cashback and rewards"
-- (an entry on the account the money went to); points themselves are not money and stay out of
-- net worth. A card's value per point (₹) is optional and only shown.

alter table ledger_accounts add column if not exists point_value numeric(10, 4) check (point_value >= 0 and point_value <= 100);

create table card_rewards (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    account_id bigint not null,
    kind text not null check (kind in ('earned', 'redeemed', 'expired', 'cashback')),
    on_date date not null,
    points numeric(14, 2) not null default 0 check (points >= 0),
    -- Cashback, or what redeemed points brought in
    amount_paise bigint not null default 0 check (amount_paise >= 0),
    -- Earned points: when they expire
    expires_on date,
    note text check (length(note) <= 200),
    -- The income entry for cashback or points redeemed for money
    entry_id bigint,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    check (kind = 'cashback' or points > 0),
    check (kind <> 'cashback' or amount_paise > 0),
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade,
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id)
);
create index card_rewards_account on card_rewards (account_id) where deleted_at is null;

alter table card_rewards enable row level security;
create policy own_rows on card_rewards for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on card_rewards to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on card_rewards from anon, authenticated;
    end if;
end $$;

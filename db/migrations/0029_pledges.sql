-- 0029: loans backed by an asset (v2 Phase 3, lib/services/loans.ts, src/core/pledge.ts).
--
-- Gold loans, and loans against a fixed deposit, an insurance policy, securities or property. The
-- asset is described and valued in a pledge, shown as pledged until the loan is released. For
-- gold, its weight and purity and the gold rate it was valued at, so its value follows the price,
-- and the lender's loan-to-value limit for the margin warning. Gold loans are often repaid with
-- monthly interest only, or all at the end (bullet).

alter table loans drop constraint if exists loans_loan_kind_check;
alter table loans add constraint loans_loan_kind_check check (loan_kind in (
    'home', 'vehicle', 'personal', 'education', 'business', 'consumer', 'other',
    'gold', 'against_fd', 'against_policy', 'against_securities', 'against_property'
));
alter table loans drop constraint if exists loans_rate_type_check;
alter table loans add constraint loans_rate_type_check check (rate_type in ('reducing', 'flat', 'interest_only', 'bullet'));

create table pledges (
    id bigint generated always as identity primary key,
    user_id integer not null,
    loan_id bigint not null,
    asset_kind text not null check (asset_kind in ('gold', 'fd', 'policy', 'securities', 'property', 'other')),
    description text not null check (length(description) between 1 and 200),
    -- What it is worth, as last valued (for gold: worked out from the weight, purity and rate)
    value_paise bigint not null check (value_paise >= 0),
    valued_on date not null,
    -- Gold only
    weight_grams numeric(9, 3) check (weight_grams > 0),
    purity_karat smallint check (purity_karat in (24, 22, 18, 14)),
    gold_rate_paise bigint check (gold_rate_paise > 0),
    -- The lender's loan-to-value limit, %
    ltv_limit numeric(5, 2) not null default 75 check (ltv_limit > 0 and ltv_limit <= 100),
    -- Given back when the loan was closed
    released_on date,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    unique (loan_id),
    check ((asset_kind = 'gold') = (weight_grams is not null and purity_karat is not null and gold_rate_paise is not null)),
    foreign key (user_id, loan_id) references loans (user_id, id) on delete cascade
);

alter table pledges enable row level security;
create policy own_rows on pledges for all to findb_user using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on pledges to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on pledges from anon, authenticated;
    end if;
end $$;

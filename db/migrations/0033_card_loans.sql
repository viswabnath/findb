-- 0033: loans on a credit card (v2 Phase 4, lib/services/loans.ts).
--
-- Two kinds, both run by the Phase 3 loan engine with their EMIs charged to a card:
--   card_emi   a purchase on the card turned into EMIs: what the card owes moves to the loan
--   card_loan  a loan against the card's limit, paid into a bank account
-- What is still owed on them blocks the card's limit (and the shared limit it is on), as banks do.

alter table loans add column if not exists card_account_id bigint;
alter table loans add constraint loans_card_account_fk
    foreign key (user_id, card_account_id) references ledger_accounts (user_id, id) on delete set null (card_account_id);

alter table loans drop constraint if exists loans_loan_kind_check;
alter table loans add constraint loans_loan_kind_check check (loan_kind in (
    'home', 'vehicle', 'personal', 'education', 'business', 'consumer', 'other',
    'gold', 'against_fd', 'against_policy', 'against_securities', 'against_property',
    'card_emi', 'card_loan'
));

-- The limit each card has blocked by loans on it that are still open
create view card_loan_blocked with (security_invoker = true) as
select l.user_id, l.card_account_id as account_id, -coalesce(sum(b.balance_paise), 0)::bigint as blocked_paise
from loans l
left join ledger_account_balances b on b.account_id = l.account_id
where l.card_account_id is not null and l.closed_on is null and l.deleted_at is null
group by l.user_id, l.card_account_id;

grant select on card_loan_blocked to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on card_loan_blocked from anon, authenticated;
    end if;
end $$;

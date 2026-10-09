-- 0009: balances live only in the ledger (docs/ledger.md, the contract step).
--
-- Since 1b every balance is read from the ledger; from now on the former balance columns are no
-- longer written either, so the ledger can hold movements the former tables cannot (transfers,
-- wallets). The comparison view ledger_balance_check is replaced by ledger_entry_check, which
-- checks what still has two records: every income and expense row must have exactly one entry in
-- the ledger that still counts, for the same amount and account. The former columns stay until the
-- last step of the move removes them, so the code from before this change keeps working while it
-- is replaced.

drop view if exists ledger_balance_check;

comment on column banks.current_balance is 'Unused since migration 0009: the balance is the ledger''s (ledger_account_balances). To be dropped.';
comment on column credit_cards.used_limit is 'Unused since migration 0009: the amount used is the ledger''s. To be dropped.';
comment on column cash_balance.balance is 'Unused since migration 0009: the cash balance is the ledger''s. To be dropped.';

-- An income or expense row whose ledger record is missing, doubled, or differs from it. Must be empty.
create view ledger_entry_check with (security_invoker = true) as
with rows_and_entries as (
    select 'income_entries'::text as source_table, i.id as source_id, i.user_id, i.source as label,
           round(i.amount * 100)::bigint as amount_paise,
           case when i.credited_to_type = 'cash' then cash.id else bank.id end as account_id
    from income_entries i
    left join ledger_accounts cash on i.credited_to_type = 'cash' and cash.user_id = i.user_id and cash.system_key = 'cash'
    left join ledger_accounts bank on i.credited_to_type = 'bank' and bank.source_table = 'banks' and bank.source_id = i.credited_to_id
    -- A zero amount records no ledger entry (an entry needs lines that move money)
    where i.amount <> 0
    union all
    select 'expenses', x.id, x.user_id, x.title, round(x.amount * 100)::bigint,
           case x.payment_method when 'cash' then cash.id when 'bank' then bank.id else card.id end
    from expenses x
    left join ledger_accounts cash on x.payment_method = 'cash' and cash.user_id = x.user_id and cash.system_key = 'cash'
    left join ledger_accounts bank on x.payment_method = 'bank' and bank.source_table = 'banks' and bank.source_id = x.payment_source_id
    left join ledger_accounts card on x.payment_method = 'credit_card' and card.source_table = 'credit_cards' and card.source_id = x.payment_source_id
    where x.amount <> 0
),
recorded as (
    select e.source_table, e.source_id, count(*) as entries,
           -- The money account's line: positive for income, negative for an expense
           max(abs(l.amount_paise)) filter (where a.subtype in ('bank', 'cash', 'credit_card')) as amount_paise,
           max(l.account_id) filter (where a.subtype in ('bank', 'cash', 'credit_card')) as account_id
    from journal_entries e
    join journal_lines l on l.entry_id = e.id
    join ledger_accounts a on a.id = l.account_id
    where e.voided_at is null and e.source_table in ('income_entries', 'expenses')
    group by e.source_table, e.source_id, e.id
)
select r.user_id, r.source_table, r.source_id, r.label, r.amount_paise, r.account_id,
       count(c.*)::int as ledger_entries, max(c.amount_paise) as ledger_amount_paise, max(c.account_id) as ledger_account_id
from rows_and_entries r
left join recorded c on c.source_table = r.source_table and c.source_id = r.source_id
group by r.user_id, r.source_table, r.source_id, r.label, r.amount_paise, r.account_id
having count(c.*) <> 1 or max(c.amount_paise) is distinct from r.amount_paise or max(c.account_id) is distinct from r.account_id;

grant select on ledger_entry_check to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on ledger_entry_check from anon, authenticated;
    end if;
end $$;

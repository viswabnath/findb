-- 0002: copy what already exists into the ledger (v2 Phase 1, docs/ledger.md).
--
-- For every user: the built-in accounts, an account for each bank and card, an opening entry for
-- each bank and for cash, and an entry for every income and expense. Then, wherever a balance in
-- the former tables still differs from the ledger's (cash set by hand, or older bugs), one
-- adjustment entry makes them equal, so the move changes no balance and every difference is
-- recorded. Safe to run again: it only adds what is missing. Checked at commit by the balance
-- triggers, and afterwards by the view ledger_balance_check, which must then be empty.

-- Built-in accounts
insert into ledger_accounts (user_id, kind, subtype, name, system_key)
select u.id, s.kind, s.subtype, s.name, s.system_key
from users u
cross join (values
    ('cash', 'asset', 'cash', 'Cash'),
    ('income', 'income', 'income', 'Income'),
    ('expense', 'expense', 'expense', 'Uncategorised'),
    ('opening_balance', 'equity', 'opening_balance', 'Opening balances'),
    ('adjustment', 'equity', 'adjustment', 'Balance adjustments')
) as s (system_key, kind, subtype, name)
on conflict (user_id, system_key) where system_key is not null do nothing;

-- A ledger account for every bank and card
insert into ledger_accounts (user_id, kind, subtype, name, source_table, source_id)
select b.user_id, 'asset', 'bank', b.name, 'banks', b.id
from banks b
where not exists (select 1 from ledger_accounts a where a.source_table = 'banks' and a.source_id = b.id);

insert into ledger_accounts (user_id, kind, subtype, name, credit_limit_paise, source_table, source_id)
select c.user_id, 'liability', 'credit_card', c.name, round(c.credit_limit * 100)::bigint, 'credit_cards', c.id
from credit_cards c
where not exists (select 1 from ledger_accounts a where a.source_table = 'credit_cards' and a.source_id = c.id);

-- Opening entries: each bank's starting balance, and the cash a user started with
with new_entries as (
    insert into journal_entries (user_id, entry_date, description, entry_type, source_table, source_id)
    select b.user_id, b.created_at::date, 'Opening balance: ' || b.name, 'opening_balance', 'banks', b.id
    from banks b
    where b.initial_balance <> 0
      and not exists (select 1 from journal_entries e where e.source_table = 'banks' and e.source_id = b.id)
    returning id, user_id, source_id
)
insert into journal_lines (user_id, entry_id, account_id, amount_paise)
select ne.user_id, ne.id, a.id, round(b.initial_balance * 100)::bigint
from new_entries ne
join banks b on b.id = ne.source_id
join ledger_accounts a on a.source_table = 'banks' and a.source_id = b.id
union all
select ne.user_id, ne.id, o.id, -round(b.initial_balance * 100)::bigint
from new_entries ne
join banks b on b.id = ne.source_id
join ledger_accounts o on o.user_id = ne.user_id and o.system_key = 'opening_balance';

with new_entries as (
    insert into journal_entries (user_id, entry_date, description, entry_type, source_table, source_id)
    select cb.user_id, cb.updated_at::date, 'Opening balance: Cash', 'opening_balance', 'cash_balance', cb.id
    from cash_balance cb
    where cb.initial_balance <> 0
      and not exists (select 1 from journal_entries e where e.source_table = 'cash_balance' and e.source_id = cb.id)
    returning id, user_id, source_id
)
insert into journal_lines (user_id, entry_id, account_id, amount_paise)
select ne.user_id, ne.id, a.id, round(cb.initial_balance * 100)::bigint
from new_entries ne
join cash_balance cb on cb.id = ne.source_id
join ledger_accounts a on a.user_id = ne.user_id and a.system_key = 'cash'
union all
select ne.user_id, ne.id, o.id, -round(cb.initial_balance * 100)::bigint
from new_entries ne
join cash_balance cb on cb.id = ne.source_id
join ledger_accounts o on o.user_id = ne.user_id and o.system_key = 'opening_balance';

-- Income: into the bank or cash it was credited to, from Income. An entry whose bank no longer
-- exists is left out (it shows up in ledger_balance_check instead of failing the move).
with targets as (
    select i.id as income_id, i.user_id,
           case when i.credited_to_type = 'cash' then cash.id else bank.id end as account_id
    from income_entries i
    left join ledger_accounts cash on i.credited_to_type = 'cash' and cash.user_id = i.user_id and cash.system_key = 'cash'
    left join ledger_accounts bank on i.credited_to_type = 'bank' and bank.source_table = 'banks' and bank.source_id = i.credited_to_id and bank.user_id = i.user_id
    where i.amount <> 0
      and not exists (select 1 from journal_entries e where e.source_table = 'income_entries' and e.source_id = i.id and e.voided_at is null)
),
new_entries as (
    insert into journal_entries (user_id, entry_date, description, entry_type, source_table, source_id)
    select i.user_id, i.date, i.source, 'income', 'income_entries', i.id
    from targets t
    join income_entries i on i.id = t.income_id
    where t.account_id is not null
    returning id, user_id, source_id
)
insert into journal_lines (user_id, entry_id, account_id, amount_paise)
select ne.user_id, ne.id, t.account_id, round(i.amount * 100)::bigint
from new_entries ne
join targets t on t.income_id = ne.source_id
join income_entries i on i.id = ne.source_id
union all
select ne.user_id, ne.id, inc.id, -round(i.amount * 100)::bigint
from new_entries ne
join income_entries i on i.id = ne.source_id
join ledger_accounts inc on inc.user_id = ne.user_id and inc.system_key = 'income';

-- Expenses: into Uncategorised, out of the bank, card or cash that paid
with targets as (
    select x.id as expense_id, x.user_id,
           case x.payment_method when 'cash' then cash.id when 'bank' then bank.id else card.id end as account_id
    from expenses x
    left join ledger_accounts cash on x.payment_method = 'cash' and cash.user_id = x.user_id and cash.system_key = 'cash'
    left join ledger_accounts bank on x.payment_method = 'bank' and bank.source_table = 'banks' and bank.source_id = x.payment_source_id and bank.user_id = x.user_id
    left join ledger_accounts card on x.payment_method = 'credit_card' and card.source_table = 'credit_cards' and card.source_id = x.payment_source_id and card.user_id = x.user_id
    where x.amount <> 0
      and not exists (select 1 from journal_entries e where e.source_table = 'expenses' and e.source_id = x.id and e.voided_at is null)
),
new_entries as (
    insert into journal_entries (user_id, entry_date, description, entry_type, source_table, source_id)
    select x.user_id, x.date, x.title, 'expense', 'expenses', x.id
    from targets t
    join expenses x on x.id = t.expense_id
    where t.account_id is not null
    returning id, user_id, source_id
)
insert into journal_lines (user_id, entry_id, account_id, amount_paise)
select ne.user_id, ne.id, exp.id, round(x.amount * 100)::bigint
from new_entries ne
join expenses x on x.id = ne.source_id
join ledger_accounts exp on exp.user_id = ne.user_id and exp.system_key = 'expense'
union all
select ne.user_id, ne.id, t.account_id, -round(x.amount * 100)::bigint
from new_entries ne
join targets t on t.expense_id = ne.source_id
join expenses x on x.id = ne.source_id;

-- Where a stored balance still differs from the ledger's, one adjustment entry closes the gap,
-- against the Balance adjustments account, linked to the bank, card or cash row it corrects
do $$
declare
    gap record;
    new_entry bigint;
    adjustment_account bigint;
begin
    for gap in
        select user_id, account_type, source_id, label, account_id, target_balance_paise - ledger_balance_paise as difference
        from ledger_balance_check
        where account_id is not null and target_balance_paise <> ledger_balance_paise
    loop
        select id into adjustment_account from ledger_accounts where user_id = gap.user_id and system_key = 'adjustment';
        insert into journal_entries (user_id, description, entry_type, source_table, source_id)
        values (gap.user_id, 'Balance adjustment from the move to the ledger: ' || gap.label, 'adjustment',
                case gap.account_type when 'bank' then 'banks' when 'credit_card' then 'credit_cards' else 'cash_balance' end,
                gap.source_id)
        returning id into new_entry;
        insert into journal_lines (user_id, entry_id, account_id, amount_paise)
        values (gap.user_id, new_entry, gap.account_id, gap.difference),
               (gap.user_id, new_entry, adjustment_account, -gap.difference);
    end loop;
end $$;

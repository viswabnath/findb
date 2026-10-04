-- 0004: the opening cash entry is dated the day the user registered (docs/ledger.md).
--
-- 0002 dated it by cash_balance.updated_at, the last time cash was edited, which can fall after
-- earlier entries; cash_balance keeps no creation date. The summary has always counted the
-- starting cash in every month since registration, so the ledger now does the same. Only dates
-- change: no amount, and no balance today.

update journal_entries e
set entry_date = u.created_at::date
from users u
where u.id = e.user_id
  and e.source_table = 'cash_balance'
  and e.entry_type = 'opening_balance'
  and e.entry_date <> u.created_at::date;

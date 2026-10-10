-- 0019: drop the former balance columns (v2 Phase 1, the contract step; docs/ledger.md).
--
-- Unused since 0009: every balance is the ledger's (ledger_account_balances). setup-db.js still
-- creates them on a new database, because 0001's original view refers to them; this removes them
-- again, as it does on an existing one. Starting balances (initial_balance) and card limits stay.

alter table banks drop column if exists current_balance;
alter table credit_cards drop column if exists used_limit;
alter table cash_balance drop column if exists balance;

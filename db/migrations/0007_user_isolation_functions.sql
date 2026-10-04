-- 0007: findb_user may run the ledger's balance check (docs/ledger.md, docs/security.md).
--
-- The balance triggers call journal_entry_must_balance, and 0001 revoked that function from
-- everyone, so a request running as findb_user (0006) could not record a journal entry. Granting it
-- lets the check run; under row level security it still reads only the user's own lines.

grant execute on function journal_entry_must_balance(bigint) to findb_user;
grant execute on function journal_lines_balance_check() to findb_user;
grant execute on function journal_entries_balance_check() to findb_user;

-- 0003: deleting a user deletes their whole ledger (docs/ledger.md).
--
-- In 0001 a journal line's link to its account blocked the account's deletion. Deleting a user
-- cascades to their accounts and entries in no fixed order, so the account could go first and the
-- delete failed. Lines now go with their account too. That cannot leave a lopsided entry behind:
-- the deferred balance check still runs at commit, and the app never deletes an account (a removed
-- bank or card is archived).

alter table journal_lines drop constraint journal_lines_user_id_account_id_fkey;
alter table journal_lines add constraint journal_lines_user_id_account_id_fkey
    foreign key (user_id, account_id) references ledger_accounts (user_id, id) on delete cascade;

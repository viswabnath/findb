-- 0027: deleting a user with groups (fixes 0026).
--
-- Shared expenses and settlements are deleted two steps from the user (user, then group, then
-- them), so their own references to ledger accounts, entries and people must not block the
-- user's deletion. The app never deletes those rows otherwise (it archives and voids), so these
-- rules only matter when a whole account is erased.

alter table shared_expenses drop constraint shared_expenses_user_id_category_id_fkey;
alter table shared_expenses add constraint shared_expenses_user_id_category_id_fkey
    foreign key (user_id, category_id) references ledger_accounts (user_id, id) on delete set null (category_id);
alter table shared_expenses drop constraint shared_expenses_user_id_entry_id_fkey;
alter table shared_expenses add constraint shared_expenses_user_id_entry_id_fkey
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id);
alter table shared_expenses drop constraint shared_expenses_user_id_paid_by_person_id_fkey;
alter table shared_expenses add constraint shared_expenses_user_id_paid_by_person_id_fkey
    foreign key (user_id, paid_by_person_id) references people (user_id, id) on delete cascade;

alter table shared_expense_shares drop constraint shared_expense_shares_user_id_person_id_fkey;
alter table shared_expense_shares add constraint shared_expense_shares_user_id_person_id_fkey
    foreign key (user_id, person_id) references people (user_id, id) on delete cascade;

alter table settlements drop constraint settlements_user_id_from_person_id_fkey;
alter table settlements add constraint settlements_user_id_from_person_id_fkey
    foreign key (user_id, from_person_id) references people (user_id, id) on delete cascade;
alter table settlements drop constraint settlements_user_id_to_person_id_fkey;
alter table settlements add constraint settlements_user_id_to_person_id_fkey
    foreign key (user_id, to_person_id) references people (user_id, id) on delete cascade;
alter table settlements drop constraint settlements_user_id_entry_id_fkey;
alter table settlements add constraint settlements_user_id_entry_id_fkey
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete set null (entry_id);

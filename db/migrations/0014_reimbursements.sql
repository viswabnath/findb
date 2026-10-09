-- 0014: reimbursements (v2 Phase 1, docs/ledger.md).
--
-- An expense paid personally that an employer, insurer or someone else will pay back. While it is
-- pending it is money owed to the user, not spending: the payment moves money into the built-in
-- "Reimbursements due" account (an asset). Repayments move it back out to the account that
-- receives them. Whatever is never repaid becomes the user's own expense when the reimbursement is
-- closed, in the category chosen for it.

alter table ledger_accounts drop constraint if exists ledger_accounts_subtype_check;
alter table ledger_accounts add constraint ledger_accounts_subtype_check check (subtype in (
    'bank', 'cash', 'credit_card', 'wallet', 'meal_card', 'receivable',
    'income', 'expense', 'opening_balance', 'adjustment'
));

alter table journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table journal_entries add constraint journal_entries_entry_type_check check (entry_type in (
    'opening_balance', 'income', 'expense', 'adjustment', 'transfer', 'reimbursable', 'reimbursement'
));

create table reimbursements (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    description text not null check (length(description) between 1 and 200),
    -- Who will pay it back: an employer, an insurer, a friend
    from_whom text check (length(from_whom) <= 100),
    amount_paise bigint not null check (amount_paise > 0),
    -- The category the part not repaid is spent in
    category_id bigint,
    event_id bigint,
    created_at timestamptz not null default now(),
    -- Closed: fully repaid, or the rest written off as the user's own spending
    settled_at timestamptz,
    unique (user_id, id),
    foreign key (user_id, category_id) references ledger_accounts (user_id, id),
    foreign key (user_id, event_id) references events (user_id, id) on delete set null (event_id)
);

alter table journal_entries add column if not exists reimbursement_id bigint;
alter table journal_entries add constraint journal_entries_reimbursement_fkey
    foreign key (user_id, reimbursement_id) references reimbursements (user_id, id) on delete set null (reimbursement_id);
create index journal_entries_reimbursement on journal_entries (user_id, reimbursement_id) where reimbursement_id is not null;

alter table reimbursements enable row level security;
create policy own_rows on reimbursements for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on reimbursements to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on reimbursements from anon, authenticated;
    end if;
end $$;

-- 0011: categories and tags (v2 Phase 1, docs/ledger.md).
--
-- A category is an income or expense account in the ledger, so an entry's category is simply the
-- account its other line uses. Every user gets the default categories (lib/categories.ts, made the
-- first time they are needed), can rename them and add their own. The built-in accounts stay as
-- the fallbacks: "Uncategorised" for spending, and the income account, now called "Other income".
-- Tags are free-form labels on any entry.

-- The default category an account is (groceries, salary...); null for the user's own
alter table ledger_accounts add column if not exists category_key text check (category_key ~ '^[a-z_]{1,40}$');
-- Spending categories: essential (rent, groceries) or discretionary (restaurants, shopping)
alter table ledger_accounts add column if not exists essential boolean;
create unique index if not exists ledger_accounts_category_key on ledger_accounts (user_id, category_key) where category_key is not null;

update ledger_accounts set name = 'Other income' where system_key = 'income' and name = 'Income';

create table tags (
    id bigint generated always as identity primary key,
    user_id integer not null references users (id) on delete cascade,
    name text not null check (length(name) between 1 and 30),
    created_at timestamptz not null default now(),
    unique (user_id, id)
);
create unique index tags_user_name on tags (user_id, lower(name));

create table entry_tags (
    user_id integer not null,
    entry_id bigint not null,
    tag_id bigint not null,
    primary key (entry_id, tag_id),
    foreign key (user_id, entry_id) references journal_entries (user_id, id) on delete cascade,
    foreign key (user_id, tag_id) references tags (user_id, id) on delete cascade
);
create index entry_tags_tag on entry_tags (user_id, tag_id);

alter table tags enable row level security;
alter table entry_tags enable row level security;
create policy own_rows on tags for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
create policy own_rows on entry_tags for all to findb_user
    using (user_id = app_user_id()) with check (user_id = app_user_id());
grant select, insert, update, delete on tags, entry_tags to findb_user;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on tags, entry_tags from anon, authenticated;
    end if;
end $$;

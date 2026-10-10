-- 0017: what each user tracks, as module switches (v2 Phase 1, lib/modules.ts).
--
-- Replaces the income / expenses / both choice (tracking_option), which stays and is kept in step,
-- so code that reads it still works. Existing users are mapped from it. declined_modules holds the
-- modules a user said no to when FinDB suggested them, so they are not offered again.

alter table users add column if not exists modules text[];
alter table users add column if not exists declined_modules text[] not null default '{}';

update users set modules = case coalesce(tracking_option, 'both')
    when 'income' then array['income']
    when 'expenses' then array['spending', 'credit_cards']
    else array['income', 'spending', 'credit_cards']
end
where modules is null;

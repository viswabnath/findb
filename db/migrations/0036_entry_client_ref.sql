-- 0036: entries added offline (v2 Phase 5, lib/offline-queue.ts).
--
-- An entry saved on the phone without signal is sent later with a reference made on the phone.
-- Sending the same reference twice (the first answer was lost on a weak connection) returns the
-- entry already made instead of a second one.

alter table journal_entries add column if not exists client_ref text check (length(client_ref) <= 64);
create unique index if not exists journal_entries_client_ref on journal_entries (user_id, client_ref) where client_ref is not null;

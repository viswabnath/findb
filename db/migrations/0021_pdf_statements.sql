-- 0021: PDF statements (v2 Phase 2, docs/ledger.md).
--
-- The browser now also reads PDF statements (src/core/statement-pdf.ts), so an import can come from
-- a PDF. A protected PDF's password opens the file in the browser and never reaches FinDB.

alter table import_batches drop constraint if exists import_batches_file_kind_check;
alter table import_batches add constraint import_batches_file_kind_check check (file_kind in ('csv', 'excel', 'pdf'));

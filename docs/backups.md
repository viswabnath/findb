# Backups

The free Supabase plan has no automatic backups, so FinDB backs up its production database
(Supabase project `findb-production-mumbai`) every night with a GitHub Actions job.

## How it works

- **When:** every night at 03:00 IST, plus whenever it is started by hand (Actions > Nightly database backup > Run workflow).
- **What:** a `pg_dump` of the `public` schema (every table, with its data, row level security settings and sequences).
- **Who reads the data:** the login `findb_backup`, which can only read. Its connection string is the repository secret `BACKUP_DATABASE_URL`.
- **Encryption:** the dump is encrypted with [age](https://age-encryption.org) before it leaves the runner. Only the private key can decrypt it.
  - The public key is in `.github/workflows/backup.yml`.
  - The private key is in `~/.findb/backup-key.txt` on the owner's computer, and is never in the repository.
- **Where:** a workflow artifact named `findb-backup-YYYY-MM-DD`, kept for 30 days.
  - In a public repository, signed-in GitHub users can download artifacts, but without the private key the file is unreadable.
- **Cost:** about a minute a day; GitHub-hosted runners are free for public repositories.
- **Not included yet:** document vault files (Supabase Storage, `documents` bucket). The dump holds their descriptions and storage paths; the files themselves are encrypted in the bucket and are not copied. Adding them to the backup is a follow-up.

## Keep the private key safe

`~/.findb/backup-key.txt` is the only way to read a backup. Copy it to a password manager or another safe place. If it is lost, every existing backup is lost with it. If it leaks:
1. Make a new key pair with `age-keygen`.
2. Put the new public key in the workflow.
3. Delete the old artifacts.

## Restore a backup

Tools: `brew install libpq age` (the PostgreSQL tools are then in `/opt/homebrew/opt/libpq/bin`).

1. Download the artifact:
   ```bash
   gh run download --name findb-backup-YYYY-MM-DD --dir /tmp/findb-restore
   ```
2. Decrypt it:
   ```bash
   age --decrypt --identity ~/.findb/backup-key.txt \
       --output /tmp/findb-restore/backup.dump /tmp/findb-restore/backup.dump.age
   ```
3. Check it:
   ```bash
   pg_restore --list /tmp/findb-restore/backup.dump
   ```
4. Restore into an empty database (a new Supabase project, or the test project to rehearse), connecting as a login that may create tables there:
   ```bash
   pg_restore --no-owner --no-privileges --dbname "<connection string>" /tmp/findb-restore/backup.dump
   ```
5. Delete the decrypted file when done:
   ```bash
   rm -rf /tmp/findb-restore
   ```

Restoring over the live production database is a last resort: restore into a new project first, check it, then point the app at it.

## Rehearsals

A restore is rehearsed on the owner's computer, so production data never leaves it and the test project stays free of it: a throwaway local PostgreSQL 17 (`brew install postgresql@17`), on 127.0.0.1 only, in a temporary folder.

```bash
B=/opt/homebrew/opt/postgresql@17/bin
$B/initdb -D <folder>/pgdata -A trust -U postgres
$B/pg_ctl -D <folder>/pgdata -o "-p 5499 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l <folder>/pg.log -w start
psql -h 127.0.0.1 -p 5499 -U postgres -c "create database findb_restore"
for r in findb_app findb_user findb_backup; do psql -h 127.0.0.1 -p 5499 -U postgres -c "create role $r nologin"; done
pg_restore -h 127.0.0.1 -p 5499 -U postgres --no-owner --no-privileges --dbname findb_restore backup.dump
DB_HOST=127.0.0.1 DB_PORT=5499 DB_USER=postgres DB_PASSWORD=x DB_NAME=findb_restore DB_SSL=false DB_SCHEMA=public node scripts/ledger-check.js
$B/pg_ctl -D <folder>/pgdata -m fast -w stop && rm -rf <folder>
```

The one expected error is `schema "public" already exists`. Check the table row counts, that `schema_migrations` lists every migration, that row level security and the `own_rows` policies are back, and that the ledger check passes.

| Date | Backup | Result |
|---|---|---|
| 2026-10-14 | `findb-backup-2026-10-14` (run 38490086036) | Decrypted and restored; 23 tables, 19 migrations, RLS on all 23 tables, 22 `own_rows` policies, 4 triggers; ledger check passed. Decrypted copy and local database deleted. |

## Before the move to Mumbai

Before production moved from Sydney to Mumbai on 2026-10-03, a full encrypted backup of the Sydney database was saved on the owner's computer, in `~/.findb/backups/`.

# Database schema management

`schema/` contains the current database shape. Each application table has one
definition file, ordered only to satisfy foreign-key dependencies. These
idempotent definitions are applied on each run so missing current tables and
indexes are created directly, without replaying the history that produced them.

`changes/` contains one-time upgrades needed by databases created from an older
schema. Applied changes are recorded in `schema_changes` with a SHA-256 checksum.
On a fresh database, the runner creates the current schema and baselines all
existing changes without replaying historical upgrades.

The old `schema_migrations` table is intentionally left in existing Neon
databases as an audit record. The runner recognizes production's
`008_update_board_project_labels_board_delete.sql` as equivalent to change 001,
so that already-applied fix is not repeated. The two competing migration 14
files are now ordinary current-schema definitions and no longer conflict.

Old change files may be pruned after every maintained database has recorded
them. Existing ledger rows can remain; only change files still needed to upgrade
a supported older database need to stay in the repository.

Run `npm run db:migrate` after setting `DATABASE_URL`.

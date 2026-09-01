# ADR: Robust schema migrations on install

- **Status:** Proposed (design only — no code yet)
- **Date:** 2026-06-29
- **Area:** Backend schema lifecycle (`app/__init__.py` boot, `app/schema_reconcile.py`, Alembic under `migrations/`, packaging)
- **Related:** `backend/DISASTER_RECOVERY.md`, the schema-reconciler commit ("STILL NEED full migration support at boot tbd")

## Context

The encrypted SQLite (SQLCipher) schema is currently created and evolved entirely inside `create_app()`, with **no migration runner**. On every boot, inside `with app.app_context():`:

1. `db.create_all()` — creates any missing **tables** (never columns).
2. `reconcile_schema()` (`app/schema_reconcile.py`) — an **additive-only** self-heal: walks `db.metadata`, and for each existing table issues idempotent `ALTER TABLE … ADD COLUMN` for missing columns and `CREATE INDEX IF NOT EXISTS` for missing indexes.
3. `note_search.ensure_fts_table()` — creates the `notes_fts` FTS5 virtual table (not expressible in SQLAlchemy metadata) and backfills it.
4. `audit_service.ensure_audit_triggers()` — installs the append-only UPDATE/DELETE triggers (also not expressible in metadata).

This is **stateless and convergent**: the model metadata is the source of truth, every step is idempotent, and there is **no schema-version marker** of any kind on an installed database.

Alembic/Flask-Migrate *is* wired up and works for manual developer use (`flask db upgrade`) against the keyed engine — `migrations/env.py` reuses the app's SQLCipher engine, and the revision chain is clean and linear (base `e3ba93127219` → head `c7d9e1f3a5b8`, 22 revisions). **But it is never run at install or boot**, and:

- `migrations/` is **not bundled** into the PyInstaller binary (it's in neither `privatescribe-backend.spec` `datas` nor `electron-builder.yml` resources). The packaged app physically lacks the migration scripts.
- A `create_all()`-built database has **no `alembic_version` table**, so Alembic treats every installed DB as being at "base." Running `flask db upgrade` against one would try to replay all 22 migrations and fail immediately on the first non-idempotent `add_column`/`create_table` that already exists.

### Why the reconciler can never be the whole answer

`reconcile_schema()` is structurally limited to changes derivable from the *target* schema:

- **Can:** add columns (nullable, or `NOT NULL` with a *constant* default), add indexes; new tables come "free" from `create_all()`.
- **Cannot (by design):** backfills/data migrations, column renames, drops, type changes, FK/CHECK/composite constraints, or `NOT NULL` columns whose default is a callable (`uuid4`, `utcnow` → added nullable instead).

Renames, backfills, and drops are inherently **ordered, stateful** operations: a rename is indistinguishable from drop+add when diffing metadata, and a backfill is data logic that lives nowhere in the model. No metadata-diff reconciler can produce them. "Perform any necessary migration" therefore *requires* explicit, ordered migration scripts — i.e. Alembic — to actually run on install.

## Decision

**Make Alembic the authoritative schema runner at boot, adopted onto the existing `create_all` installs via a one-time "converge-then-stamp," then `upgrade` on every launch thereafter.** Keep the idempotent installers (FTS5, audit triggers) and demote `reconcile_schema()` to a thin additive **safety net** — exactly the "born before Alembic bootstrap" its docstring anticipates.

### Boot algorithm

```
with app.app_context():
    backup_db_if_pending()                  # snapshot before any migration (see Failure safety)
    if not has_alembic_version_table():
        # Adoption path: this DB has never been seen by Alembic.
        db.create_all()                      # fresh install: build tables; legacy: no-op
        reconcile_schema()                   # legacy install: additive heal to current models
        flask_migrate.stamp(revision='head') # record "fully migrated up to head"
    else:
        flask_migrate.upgrade()              # steady state: apply only NEW migrations
    reconcile_schema()                       # safety net: additive drift only
    note_search.ensure_fts_table()           # idempotent
    audit_service.ensure_audit_triggers()    # idempotent
```

Three states, one convergent path:

| DB state on boot | Branch | Result |
|---|---|---|
| Fresh (no tables, no `alembic_version`) | adopt | `create_all` builds schema → stamped at head |
| Legacy `create_all` DB (tables, no `alembic_version`) | adopt | reconciler converges to current models → stamped at head |
| Already adopted (`alembic_version` present) | upgrade | runs only migrations newer than the stamp |

After the first release that ships this, **every** installed DB carries `alembic_version`, and all future schema changes — including renames, backfills, drops, type changes — ship as ordinary Alembic migrations that run on launch.

**Why stamp-at-head instead of replaying base→head on adoption:** a legacy `create_all` DB already has the current schema; replaying 22 migrations would collide with existing objects (most aren't idempotent). Converging with the existing reconciler and stamping head is the safe, fast adoption. The (small, pre-existing) risk that the reconciler couldn't perfectly reproduce head — e.g. a `NOT NULL`-with-callable-default added as nullable — is **no worse than today**, and is correctable later with a normal repair migration.

## Failure safety (phase 1: snapshot + manual restore)

A failed migration here is far more dangerous than a missing column: an offline, single-copy, **encrypted PHI** database with no DBA. Phase 1 takes the conservative, manual posture (auto-restore is a later enhancement):

- **Before** running any pending migration (i.e. only when `upgrade()` actually has work, or on first adoption), copy the live DB file to a timestamped snapshot under the data dir, e.g. `instance/db-backups/privatescribe-<from_rev>-<ts>.db`. (Use the SQLCipher master from the same `.env`; the snapshot is a byte copy of the already-encrypted file, so no re-encryption is needed.)
- On migration failure: **do not serve.** Surface a clear, actionable error that names the snapshot path and points at `DISASTER_RECOVERY.md` for the restore step. The operator restores manually (consistent with the existing break-glass CLI ethos — anyone who can restore already holds the key).
- Retain the last *N* snapshots (config; prune oldest). Snapshots are full-DB-size; document the disk cost.
- **Later enhancement (deferred):** automatic restore-and-retry / restore-and-refuse on failure, once the manual flow is proven in the field.

Alembic wraps each migration in a transaction (SQLite DDL is largely transactional), so most failures roll back cleanly on their own; the snapshot is the belt-and-suspenders for power loss mid–batch-rebuild or a logically-wrong migration.

## Packaging changes

1. **Bundle the scripts.** Add `migrations/` (env.py + `versions/`) to `privatescribe-backend.spec` `datas`. The PyInstaller *onedir* output already ships via `electron-builder.yml` (`backend/dist/privatescribe-backend → backend`), so no separate electron-builder change is needed once it's a PyInstaller data file. `flask_migrate` is already a hidden import.
2. **Resolve the directory.** Set `Migrate(app, db, directory=<resolved>)` so the runner finds the scripts in the packaged layout (`sys._MEIPASS` / bundle path), not a CWD-relative `migrations/`. Route through `app/paths.py` for consistency with the data-dir handling.
3. **No new dependency** — Alembic/Flask-Migrate are already installed and engine-compatible (`migrations/env.py` reuses the keyed engine).

## Migration-authoring conventions going forward

- Enable batch mode + type comparison globally: `Migrate(..., render_as_batch=True, compare_type=True)` so SQLite ALTER (drop/rename/retype via table rebuild) autogenerates correctly. (19/22 existing migrations already call `op.batch_alter_table` explicitly; this makes it the default.)
- Migrations that touch objects the reconciler also manages (FTS5 table, triggers) stay idempotent (`IF NOT EXISTS`) so the post-`upgrade` installers never conflict.
- Schema changes ship as migrations; the reconciler remains only as an additive safety net for forgotten columns.

## Rollout plan

- **Phase 1 (this initiative):** boot adoption-then-upgrade + bundling + directory resolution + pre-migration snapshot (manual restore) + global batch/compare. Reconciler retained as safety net. Ship; every install becomes `alembic_version`-stamped.
- **Phase 2 (ongoing):** author all subsequent schema changes as migrations; exercise a real rename/backfill/drop to prove the path end-to-end.
- **Phase 3 (later):** automatic restore on failure; consider demoting/removing the reconciler once all fielded DBs are demonstrably stamped; revisit for the planned Postgres tier (`PRIVATESCRIBE_DATABASE_URL` is currently a `NotImplementedError` stub — migrations there are a separate, real concern).

## Test plan

Extend `scripts/e2e_smoke_test.py` (which already simulates legacy drift in `_schema_drift_regression`):

1. **Adoption of a legacy `create_all` DB:** boot with tables but no `alembic_version` → assert it ends stamped at head and serves.
2. **A new migration applies on an adopted DB:** add a throwaway migration after head, boot again → assert `upgrade()` ran it and advanced `alembic_version`.
3. **Fresh install:** empty DB → stamped at head, schema present.
4. **Failure path:** a deliberately-failing migration → assert the snapshot exists, the app refuses to serve, and the error names the backup path (DB unchanged / restorable).
5. **Packaged reachability:** a build-time check that `migrations/versions/` is present in the PyInstaller bundle.

## Risks & open questions

- **Stamp-at-head trusts reconciler convergence.** Acceptable (no regression vs today); correctable via a later repair migration. *Open:* do we want a one-time consistency-audit migration after adoption?
- **Batch rebuilds on large/encrypted tables** cost time + temp space (full table copy). Fine for a single-user local DB; revisit for server mode.
- **Snapshot disk cost** and retention count — *open:* default `N` and location (under `instance/`, honoring `PRIVATESCRIBE_DATA_DIR`).
- **Concurrent boots** (server mode, multiple workers) racing `upgrade()` — *open:* a boot-time lock so only one process migrates. Not a concern for the single-process desktop app today.

## Alternatives considered

- **Extend the declarative reconciler** to do drops/type-changes via metadata diff. Rejected: cannot express renames or backfills (data logic absent from metadata); "any migration" is fundamentally an ordered-script problem.
- **Make all 22 migrations idempotent and always run base→head.** Rejected: large, brittle rewrite; converge-then-stamp achieves the same adoption with far less risk.
- **Schema-fingerprint detection of the baseline revision.** Rejected as fragile; stamp-at-head is simpler and sufficient.

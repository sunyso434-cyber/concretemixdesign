# Database Baseline Debug Report

- Date: 2026-07-15
- Status: DONE

## Symptom

The packaged application stopped before creating its main window and reported that the database structure baseline failed with a Sequelize `Validation error`.

## Root Cause

Older releases repeatedly ran `model.sync({ alter: true })` and continued after individual model failures. Failed SQLite alter operations left populated Sequelize temporary tables such as `materials_backup`, `optimization_history_backup`, and `insulationMaterials_backup` in the user database.

On the next alter, Sequelize reused the existing temporary table and executed an `INSERT ... SELECT` from the current table. Existing primary keys in the stale temporary table caused `SQLITE_CONSTRAINT: UNIQUE constraint failed: materials_backup.id`.

## Fix

Before altering current models, the baseline transaction now detects only temporary tables matching a current model table name plus `_backup`. Each matching table is renamed to a timestamped `*_legacy_backup_*` table instead of being deleted. The migration record stores the source and target names. If a later migration step fails, the transaction rolls the renames back.

The surfaced migration error now prefers the underlying SQLite error instead of the generic Sequelize `Validation error`.

## Evidence

- A fresh copy of the real 58 MB pre-migration database reproduced the primary-key collision.
- Renaming the stale temporary tables allowed the complete model baseline to finish.
- The final implementation migrated a fresh real database copy successfully.
- All 59 current material rows remained available.
- Three conflicting temporary tables and their rows remained available under quarantined names.
- Full test result: 177 suites, 1502 tests, and 2 snapshots passed.
- Windows NSIS and portable packages were rebuilt successfully.

## Regression Test

`src/main/__tests__/db/schemaMigrator.test.js` creates a populated `items_backup` table with a duplicate primary key, then verifies that the baseline succeeds, current data is retained, and stale backup data is preserved in a quarantined table.

## Related

The legacy `basicMixDesigns_backup` table belongs to a removed model and is not touched because no current model can collide with it. This keeps the recovery behavior narrowly scoped.

## Follow-up Startup Failures

After the schema baseline was fixed, strict startup exposed several older defects that previous releases had hidden:

1. `SystemService.initDefaultParams()` called an undeclared `logger` only when an old database contained `strengthStdDev_C25`. The service now uses its existing `console.log` interface, and the regression test seeds and removes that legacy row.
2. The IPC allowlist was initially imported by `preload.js` through `require('./ipcChannelPolicy')`. Electron 28 sandboxed preloads cannot load local modules, so the preload aborted and the renderer installed a browser mock without `workspace.current` or `workspace.pickFolder`. This made folder selection fail and history views appear blank. The allowlist is now self-contained in `preload.js`, the sandbox remains enabled, and a regression test rejects future relative preload imports.
3. Once the real preload was restored, `AgentMode` still could not receive `agent:progress` or `agent:confirmation-request` because those existing event channels were absent from the new allowlist. The subscription exception was intentionally caught by the component, leaving the UI at "AI is thinking" while logs showed successful backend completion. Both channels are now allowed and covered by the preload boundary test.

Final packaged-runtime verification confirmed the complete `workspace` API, successfully subscribed to both Agent event channels, successfully read a real three-message historical session from a database copy, and found all 2284 messages across 59 sessions intact. The original `D:/C-c/new` and `D:/C-c/UHPC` workspace directories also still exist. The user then confirmed that the latest packaged build restored streaming output.

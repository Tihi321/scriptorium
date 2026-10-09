# Spike: node:sqlite + sqlite-vec + FTS5

Date: 2026-10-08. Scripts: `scripts/spike-sqlite.mjs` (the checks) and `scripts/spike-electron.cjs` (runs the same file inside an Electron utilityProcess).

Run it yourself:
- Plain Node: `node scripts/spike-sqlite.mjs`
- Electron: `npx electron scripts/spike-electron.cjs`

## What it checks

1. `new DatabaseSync(':memory:', { allowExtension: true })` opens.
2. FTS5: create an `fts5` virtual table, insert two rows, `MATCH 'silver'` returns the right row.
3. `db.loadExtension(getLoadablePath())` loads the `sqlite-vec` extension (`vec0.dll`), and `vec_version()` answers.
4. A `vec0` table (4 dimensions) takes three vectors and a KNN query (`embedding match ? and k = 2`) returns the nearest two in order.

## Results

| | Plain Node | Electron utilityProcess |
|---|---|---|
| Runtime | Node 24.14.0 (fnm) | Electron 44.7.0, bundled Node 24.21.0 |
| SQLite version | 3.51.2 | 3.53.4 |
| `DatabaseSync` with `allowExtension` | pass | pass |
| FTS5 | pass | pass |
| `loadExtension(sqlite-vec)` | pass (`v0.1.9`) | pass (`v0.1.9`) |
| vec0 KNN | pass (rowid 1 at 0, rowid 3 at 0.1414) | pass (same) |

Both runs used the same file `node_modules/sqlite-vec-windows-x64/vec0.dll`. No native rebuild was needed for Electron.

Only warning: `ExperimentalWarning: SQLite is an experimental feature` in plain Node (the module is still marked experimental in Node 24).

## Decision

No failure, so `node:sqlite` plus `sqlite-vec` stays the plan. `better-sqlite3` was not evaluated because it wasn't needed.

## Notes for Phase 6

- Bind vectors as `Uint8Array` over a `Float32Array` buffer, and rowids as `BigInt` (`1n`) for `vec0` inserts.
- `getLoadablePath()` points into `node_modules`. In the packaged app (Phase 10) the `.dll` must be unpacked from the asar archive (`asarUnpack` for `sqlite-vec-windows-x64`) because a loadable extension can't be read from inside an archive.
- Electron's Node (24.21) is newer than the dev Node (24.14), and its SQLite differs (3.53.4 vs 3.51.2). Index files made by one can be read by the other, but the index is rebuildable anyway.

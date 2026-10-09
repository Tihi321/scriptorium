// Spike: can node:sqlite load the sqlite-vec extension, and is FTS5 available?
// Run in plain Node:   node scripts/spike-sqlite.mjs
// Run in Electron:     npx electron scripts/spike-electron.cjs   (forks this file as a utilityProcess)
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const out = { runtime: process.versions.electron ? `electron ${process.versions.electron}` : 'node', node: process.versions.node, sqlite: null, checks: {} }
const check = (name, fn) => {
  try {
    out.checks[name] = { ok: true, value: fn() }
  } catch (err) {
    out.checks[name] = { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

const db = new DatabaseSync(':memory:', { allowExtension: true })
out.sqlite = db.prepare('select sqlite_version() as v').get().v

check('fts5', () => {
  db.exec("create virtual table docs using fts5(body)")
  db.exec("insert into docs(body) values ('the silver inn by the sea'), ('a quiet harbour town')")
  return db.prepare("select rowid from docs where docs match 'silver'").all().map((r) => Number(r.rowid))
})

check('load sqlite-vec', () => {
  const { getLoadablePath } = require('sqlite-vec')
  const p = getLoadablePath()
  db.loadExtension(p)
  return { path: p, vec_version: db.prepare('select vec_version() as v').get().v }
})

check('vec0 knn', () => {
  db.exec('create virtual table v using vec0(embedding float[4])')
  const ins = db.prepare('insert into v(rowid, embedding) values (?, ?)')
  const f = (...a) => new Uint8Array(new Float32Array(a).buffer)
  ins.run(1n, f(1, 0, 0, 0))
  ins.run(2n, f(0, 1, 0, 0))
  ins.run(3n, f(0.9, 0.1, 0, 0))
  const rows = db
    .prepare('select rowid, distance from v where embedding match ? and k = 2 order by distance')
    .all(f(1, 0, 0, 0))
  return rows.map((r) => ({ rowid: Number(r.rowid), distance: Number(r.distance.toFixed(4)) }))
})

db.close()
const msg = JSON.stringify(out)
if (process.parentPort) process.parentPort.postMessage(msg)
console.log(JSON.stringify(out, null, 2))
process.exit(Object.values(out.checks).every((c) => c.ok) ? 0 : 1)

// Verifies the unpacked Windows build (release/win-unpacked) without starting Scriptorium (starting it resumes the book
// factory). It checks the packaged layout, then runs the exe as plain Node (ELECTRON_RUN_AS_NODE=1) only to load
// sqlite-vec and the keyring native module from the packaged tree. Exit code 0 on success.
// Usage: node scripts/verify-package.mjs [unpackedDir]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.resolve(process.argv[2] ?? path.join(root, 'release', 'win-unpacked'))
const exe = path.join(dir, 'Scriptorium.exe')
const res = path.join(dir, 'resources')
const app = path.join(res, 'app')

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}
const has = (...p) => fs.existsSync(path.join(...p))

check(fs.existsSync(exe), `exe present: ${exe}`)
check(!has(res, 'app.asar'), 'no app.asar (asar is off: native files must be real files)')
const pkg = has(app, 'package.json') ? JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')) : null
check(pkg?.main === './out/main/index.js', `package.json main -> ${pkg?.main}`)
for (const f of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'out/engine/index.js']) check(has(app, f), `${f} is packaged`)
for (const f of ['config', 'prompts', 'templates', 'agents', 'topics.md']) check(has(res, 'seed', f), `seed/${f} is packaged`)
check(has(res, 'icon.png'), 'resources/icon.png present')
check(has(app, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll'), 'sqlite-vec vec0.dll is a real file')
const keyringDir = path.join(app, 'node_modules', '@napi-rs')
const keyringNative = fs.existsSync(keyringDir) ? fs.readdirSync(keyringDir).filter((d) => d.startsWith('keyring-win32-x64')) : []
check(keyringNative.length > 0 && fs.readdirSync(path.join(keyringDir, keyringNative[0])).some((f) => f.endsWith('.node')), `keyring native .node present (${keyringNative[0] ?? 'missing'})`)
check(!fs.existsSync(path.join(app, 'out', 'engine', 'index.js.map')), 'no source maps shipped')
if (failures.length) { console.error(`\nverify-package FAILED (${failures.length})`); process.exit(1) }

// Load the native pieces from the packaged tree, as plain Node. The script never opens a window or an engine.
const probe = `
const path = require('node:path'); const { createRequire } = require('node:module');
const req = createRequire(path.join(${JSON.stringify(app)}, 'package.json'));
const vec = req('sqlite-vec'); const p = vec.getLoadablePath();
if (!require('node:fs').existsSync(p) || p.includes('app.asar')) throw new Error('bad sqlite-vec path ' + p);
req('@napi-rs/keyring');
console.log('native ok ' + p);`
const r = spawnSync(exe, ['-e', probe], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000, windowsHide: true })
check(r.status === 0 && /native ok/.test(r.stdout), `sqlite-vec and keyring load from the packaged tree${r.status === 0 ? `: ${r.stdout.trim()}` : `: ${(r.stderr || r.error?.message || '').slice(0, 400)}`}`)

if (failures.length) { console.error(`\nverify-package FAILED (${failures.length})`); process.exit(1) }
console.log('\nverify-package passed')

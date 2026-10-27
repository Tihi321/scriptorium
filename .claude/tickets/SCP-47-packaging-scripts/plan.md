# SCP-47: Windows packaging scripts

Branch `SCP-47_packaging-scripts`. Reference followed: api-acp-proxy (config .cjs, verify-package, icons script, release/ output). The repo already had `electron-builder.yml` (NSIS, `asar: false`, output `dist/`) and `build/make-icon.mjs`; this ticket converts them to the ACP proxy layout.

## Changes
1. `electron-builder.config.cjs` replaces `electron-builder.yml`: appId `com.tihi321.scriptorium` (kept), productName Scriptorium, output `release/`, `asar: false` (sqlite-vec vec0.dll and keyring .node must be real files), files `out/**` + package.json, extraResources `seed/` and `build/icon.png`, win targets nsis + portable x64, NSIS as before, portable artifactName.
2. `scripts/make-icons.mjs` (moved from `build/make-icon.mjs`, writes to `build/`), script `icons`.
3. `scripts/verify-package.mjs`: checks `release/win-unpacked` (exe, resources/app/out main/preload/renderer/engine, package.json main, resources/seed with config + prompts, icon.png, sqlite-vec vec0.dll, keyring .node, no app.asar), then runs the exe under ELECTRON_RUN_AS_NODE to load sqlite-vec and keyring from the packaged tree. Never starts the app or engine.
4. package.json scripts: dist, dist:installer, dist:portable, dist:dir, verify:package, icons (yarn bodies).
5. .gitignore `release/`; update `playwright.packaged.config.ts` and `tests/renderer/packaged.electron.spec.ts` paths dist -> release.
6. README packaging section, docs/design.md Packaging row, ROADMAP SCP-47.

## Verify
`yarn build`, `yarn dist:dir`, `yarn verify:package`, then `yarn dist:portable`. Never launch the app.

# Changelog

## 2026-10-27 SCP-47: Windows packaging scripts
Branch `SCP-47_packaging-scripts`. electron-builder.yml became electron-builder.config.cjs (output `release/`, NSIS + portable, asar stays off); new `scripts/verify-package.mjs`; `build/make-icon.mjs` moved to `scripts/make-icons.mjs`; package.json scripts dist, dist:installer, dist:portable, dist:dir, verify:package, icons; `.gitignore` release/; packaged Playwright spec and config point at release/; README, docs/design.md, ATTRIBUTION, ROADMAP updated.
Verification: `yarn build`, `yarn dist:dir`, `yarn verify:package` passed; `yarn dist:portable` produced Scriptorium-Portable-0.0.1-x64.exe (107 MB) and verify passed. Not run: `dist`/`dist:installer` (NSIS), `test:packaged`, any launch of the app (it resumes the book factory).

# Scriptorium

- `docs/design.md` is the source of truth for what to build. Read its Decisions table first. Later rows override earlier ones. When a decision changes, update the table, the relevant section, and the History at the bottom.
- The MVP scope is in `docs/design.md` under "Milestones → MVP: text only". Milestone 2 (ComfyUI images) and everything under "Later" are out of scope until the MVP works.
- The user wants the factory fully automated. The UI is mainly for watching: keep on-screen controls to the ones listed in the UI decision row, and put everything else in markdown config files.
- All information agents share, and everything the UI shows, lives in plain markdown files with YAML frontmatter (see "Shared files" in the design doc). The only exceptions are EPUB and image output, and the SQLite search index, which must stay rebuildable from the files.
- API keys never go in the repository or in the data folder's markdown files. Store them in Windows' credential store or in environment variables.
- Book content is English only.

## Machine (Windows 11, INFLAME-TIHI)

- Node is only available through fnm (v24.14.0 is the default) and is not on PATH in non-interactive shells. Run `fnm env --use-on-cd | Out-String | Invoke-Expression` (PowerShell) first, or call the fnm Node directly.
- Git 2.55 with `core.autocrlf=true`. `gh` is not installed. Python 3.13 (`py`) is available.
- LM Studio is installed (CLI `~\.lmstudio\bin\lms.exe`, server is OpenAI-compatible). `lms ls` lists its models. The model table is in the design doc under "Model layer". Ollama is not installed.
- Strata (`D:\Strata`) is a local Qwen3.8-Flash-Next server with an OpenAI-compatible API on port 8080. Start it with `run-iq3_s.bat` (about 84 GB) or `run-iq2_xs.bat` (about 48 GB, lower quality), check `curl http://127.0.0.1:8080/health` for `loaded: true`. Both use the same model ids in Scriptorium. With IQ3_S, keep only the nomic model loaded in LM Studio. `run-coder-iq1_m.bat` is the coding model; only one Strata runs at a time (all use port 8080). Every model has `run-<model>-parallel.bat` (`"parallel": 4`, no `--batch-mtp`: measured slower) and `run-<model>-solo.bat`; the older `run-iq3_s.bat` is solo, `run-iq2_xs.bat` and `run-coder-iq1_m.bat` are parallel. Scriptorium has `concurrency: auto` for Strata: it reads the slot count from `http://127.0.0.1:8080/v1/status` every 10 seconds, so switching scripts needs no config change.
- 128 GB unified memory; Windows sees 32 GB, so about 96 GB is left for models.

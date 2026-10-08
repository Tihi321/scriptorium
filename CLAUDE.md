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
- 128 GB unified memory; Windows sees 32 GB, so about 96 GB is left for models.

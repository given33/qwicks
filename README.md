# Teamflow Desktop

Teamflow Desktop is a Windows local single-user agent workflow studio.

It replaces the old Warp-first Teamflow V2 entrypoint with a Tauri desktop app:

- Codex architect panel: accepts project goals and delegates tasks sequentially.
- Dashboard: shows the SQLite task board, current run, progress, events, local verification, and MiMo review status.
- Claude executor panel: runs the hidden Claude Code worker and renders translated agent messages.
- Diagnostics drawer: keeps raw CLI transcripts, stderr, process events, MCP calls, and verification output available without showing terminal windows by default.

## Start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-teamflow-desktop.ps1
```

The desktop shortcut `C:\Users\28219\Desktop\Open-Teamflow-Workflow.cmd` points at this script.

## Build Installer

Teamflow Desktop uses Tauri and requires Rust/Cargo plus Node.js/npm.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-teamflow-desktop.ps1
```

If Rust is missing, the script exits with code `2` and prints the install URL.

## Runtime Model

- SQLite remains the source of truth in repo-local `runtime\teamflow.sqlite3`.
- `runtime\tasks.json` is still a read-only exported snapshot.
- The Tauri backend initializes the current run, schema, events, agent messages, raw transcripts, and process events.
- Codex and Claude Code still run through the installed local CLI binaries, but Teamflow captures their output and translates it into app messages.
- Raw CLI output is stored locally for diagnostics.

## Legacy Warp Entry

The old Warp workflow is kept only as a fallback:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-teamflow-warp-legacy.ps1
```

Warp is no longer the default Teamflow entrypoint.

## Secrets

Do not write MiMo keys into this repository. Teamflow reads keys from user or process environment variables:

- `MIMO_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_API_KEY`
- `XIAOMI_MIMO_API_KEY`
- `MIMO_KEY`

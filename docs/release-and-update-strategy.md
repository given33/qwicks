# Teamflow Release and Update Strategy

## Repository Roles

- GitHub `main`: clean source code that can be built and released.
- GitHub Releases: versioned installers, updater artifacts, signatures, and release notes.
- Local bare backup: complete recovery storage for dirty worktrees, experiments, evidence, and large historical artifacts.

## Current Local Layout

- Release source worktree: `D:\MCP\teamflow-release-main`
- Active migration worktree: `D:\MCP\teamflow`
- Local full backup: `D:\git-backups\teamflow-desktop-full.git`
- Workspace archive: `D:\MCP\_teamflow-workspace-archive`

## GitHub Main Policy

Only commit maintainable source, tests, scripts, and docs to GitHub `main`.

Do not commit:

- `target/`, `node_modules/`, `.npm-cache/`, `.cargo-home/`
- `runtime/`, `workspace/`, `.tmp/`, `.workflow/`
- installer binaries, rollback snapshots, local review evidence, or one-off agent logs

Large generated files belong in GitHub Releases or the local bare backup.

## GitHub Release Policy

Each public release should contain:

- NSIS installer: `Teamflow Desktop_<version>_x64-setup.exe`
- MSI installer: `Teamflow Desktop_<version>_x64_zh-CN.msi`
- updater signatures when updater artifacts are enabled
- `latest.json` once the updater endpoint is active
- release notes with build commit, version, date, and verification results

## Hot Update Requirements

Teamflow uses Tauri. Tauri updater artifacts require signing. The private signing key must never be committed.

Before enabling real in-app hot update:

1. Generate a Tauri updater signing key.
2. Store the private key outside Git, for example in a local secret store or GitHub Actions secret.
3. Put only the public key in `src-tauri/tauri.conf.json`.
4. Set `bundle.createUpdaterArtifacts` to `true`.
5. Configure `plugins.updater.endpoints` to a GitHub Release `latest.json` URL.
6. Build with `TAURI_SIGNING_PRIVATE_KEY` set in the environment.
7. Upload installers, updater signatures, and `latest.json` to GitHub Releases.

The current repository is organized for this flow, but updater signing is not enabled until the key and endpoint are configured.

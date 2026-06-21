# QWicks Release and Update Strategy

## Current Flow

- GitHub `main`: source code and CI configuration.
- GitHub Actions code-update workflow: builds `code.zip` on every push to `main`.
- GitHub Actions installer workflow: builds the Windows NSIS installer only when run manually.
- Aliyun server: hosts `latest.json`, `code.zip`, and the fallback installer feed.
- Client updater: reads `latest.json` first for code updates, then falls back to `latest.yml` for full installer updates.

Default update URL while there is no domain:

```text
http://8.138.40.16/qwicks/channels/stable/latest/
```

After a domain is ready, set the GitHub repository variable
`QWICKS_UPDATE_BASE_URL` to the domain path, for example:

```text
https://update.haoyongai.xyz/qwicks
```

Then rebuild and deploy one new version so installed clients learn the new
update base URL.

## Code Update Files

The normal update directory contains:

- `latest.json`: code-update manifest read by QWicks.
- `code.zip`: renderer, preload, and `qwicks/dist` runtime code.

For the stable channel these files live under:

```text
/var/www/qwicks/channels/stable/latest/
```

The server should expose that path publicly as:

```text
http://8.138.40.16/qwicks/channels/stable/latest/
```

Installed clients need one full hot-update-capable shell before code-only
updates can apply. After that, ordinary UI/runtime changes can be delivered
by replacing `latest.json` and `code.zip`, then restarting the app.

The hot `qwicks/dist` runtime reuses the dependency directory from the
installed shell through a local directory link. That keeps code packages small.
If a runtime change adds or upgrades dependencies, raise `QWICKS_MIN_SHELL_VERSION`
and ship a full installer first.

Use a full installer update when changing Electron, native dependencies,
installer settings, or main-process shell behavior.

## Installer Update Files

The fallback Windows installer feed contains:

- `latest.yml`: Electron updater metadata used by the app.
- `latest.json`: human/API friendly installer manifest for the server.
- `QWicks-<version>-win-x64.exe`: installer.
- `QWicks-<version>-win-x64.exe.blockmap`: differential download metadata.

For the stable channel these files live under:

```text
/var/www/qwicks/channels/stable/latest/
```

The server should expose that path publicly as:

```text
http://8.138.40.16/qwicks/channels/stable/latest/
```

## GitHub Secrets

Required for automatic upload:

- `SERVER_SSH_KEY`

Optional:

- `SERVER_SSH_USER`, default `root`
- `SERVER_SSH_HOST`, default `8.138.40.16`
- `SERVER_SSH_PORT`, default `22`

## Source Policy

Commit source, tests, scripts, workflows, and docs to `main`.

Do not commit generated outputs:

- `dist/`
- `out/`
- `node_modules/`
- installer binaries
- local logs and temporary runtime state

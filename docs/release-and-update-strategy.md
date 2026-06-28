# QWicks Release and Update Strategy

## Current Flow

- GitHub `main`: source code and CI configuration.
- CI (`CI (qwicks runtime)`): typechecks and runs the stable GUI/runtime test
  gates. It does not publish artifacts.
- Code Update Release: checks every push to `main`, then builds and uploads
  `code.zip` only when the change set is hot-update safe.
- Windows Installer Release: builds and uploads the Windows NSIS installer only
  when the change set needs a new shell/native package, and can also be run
  manually.
- Aliyun server: hosts the installer feed plus the dedicated code-update feed.
- Client updater: reads `latest/code/code-latest.json` first for code updates,
  then falls back to `latest.yml` for full installer updates.

The release workflows share two scripts as the source of truth:

- `scripts/classify-release-change.cjs`: decides `code`, `installer`, or `none`.
- `scripts/compute-update-version.cjs`: computes the app version.

Each release workflow writes a GitHub Actions step summary. If a run is green
but skipped, the summary explicitly says that no artifact was built and no server
deploy happened.

## Versioning

Installer and code updates use the same monotonic version sequence:

```text
0.2.<git commit count>
```

Manual workflow dispatch may pass an explicit `x.y.z` version override, but
four-part versions such as `0.2.319.1` are rejected because `electron-updater`
requires normal semver. Keeping installer and code updates in one sequence
prevents the app from comparing a hot-code version against a shell version from
a different series.

## Release Classification

`code.zip` contains only:

- `out/renderer/*`
- `out/preload/*`
- `qwicks/dist`
- `qwicks/package.json`

Therefore only these source areas are treated as hot-update safe:

- `src/renderer/**`
- `src/renderer-mqpet/**`
- `src/renderer-mqconsole/**`
- `src/preload/**`
- `src/asset/**`
- `qwicks/src/**`
- `qwicks/package.json`

Full installer releases are required for:

- `src/main/**`
- `src/shared/**` because main/preload/renderer can all import shared contracts
- dependency changes such as `package.json`, `package-lock.json`, or
  `qwicks/package-lock.json`
- Electron/electron-builder/Vite/TypeScript packaging config
- `scripts/**`
- native/vendor/resource/build files

Docs, tests, and workflow-only changes run CI but do not publish an app update
by default. Manual workflow dispatch can still force a code update or installer
when needed.

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

- `code/code-latest.json`: code-update manifest read by QWicks.
- `code.zip`: renderer, preload, and `qwicks/dist` runtime code.

By default the workflow detects the Nginx static web root on the server. It
first looks for the directory currently serving the installer `/latest.json`,
then uploads into its `qwicks` subdirectory. For the stable channel these files
live under:

```text
<nginx-web-root>/qwicks/channels/stable/latest/code/
```

The server should expose that path publicly as:

```text
http://8.138.40.16/qwicks/channels/stable/latest/code/
```

Installed clients need one full hot-update-capable shell before code-only
updates can apply. After that, ordinary UI/runtime changes can be delivered
by replacing `code-latest.json` and `code.zip`, then restarting the app.

While there is no domain, QWicks allows the public HTTP update feed at the
server IP. The client still verifies the downloaded `code.zip` against the
SHA256 recorded in `latest.json` before installing it. If you need to disable
public HTTP updates temporarily, start the app with:

```text
QWICKS_BLOCK_INSECURE_UPDATES=1
```

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
<nginx-web-root>/qwicks/channels/stable/latest/
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
- `QWICKS_SERVER_DEPLOY_PATH`, override when the server should upload somewhere
  other than the detected `<nginx-web-root>/qwicks`

## Source Policy

Commit source, tests, scripts, workflows, and docs to `main`.

Do not commit generated outputs:

- `dist/`
- `out/`
- `node_modules/`
- installer binaries
- local logs and temporary runtime state

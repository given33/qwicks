# QWicks Release and Update Strategy

## Current Flow

- GitHub `main`: source code and CI configuration.
- GitHub Actions: builds the Windows NSIS installer on every push to `main`.
- Aliyun server: hosts the Electron update feed and installer files.
- Client updater: reads `latest.yml` from the Aliyun public update URL.

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

## Update Files

The Windows update directory contains:

- `latest.yml`: Electron updater metadata used by the app.
- `latest.json`: human/API friendly version manifest for the server.
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

- `ALIYUN_SSH_USER`
- `ALIYUN_SSH_KEY`

Optional:

- `ALIYUN_SSH_HOST`, default `8.138.40.16`
- `ALIYUN_SSH_PORT`, default `22`

## Source Policy

Commit source, tests, scripts, workflows, and docs to `main`.

Do not commit generated outputs:

- `dist/`
- `out/`
- `node_modules/`
- installer binaries
- local logs and temporary runtime state

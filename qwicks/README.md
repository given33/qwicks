# QWicks

QWicks is the local HTTP/SSE agent runtime for the QWicks desktop app. It exposes a
TypeScript-typed agent loop with a stable, GUI-friendly contract:

- `qwicks serve` starts a local HTTP server with `/v1/*` routes.
- Threads, turns, events, approvals, and usage are persisted as append-only
  JSONL logs with atomic index updates.
- The loop is cache-first by construction: immutable prompt prefix, bounded
  TTL/LRU caches, inflight tracking, and explicit context compaction.

The name QWicks is inspired by the great fish in Zhuangzi's line,
"In the northern sea there is a fish; its name is QWicks." In
this project, it means a deeper local runtime rather than a thin model
UI: one agent loop that can carry project context, call tools
reliably, resume sessions, and serve desktop chat, writing, phone
connections, and scheduled tasks.

QWicks's core goal is to improve the ROI of every token. Tokens should be
spent on user requirements, code, decisions, and results, not repeated
tool schemas, runaway tool output, malformed history, useless retries,
or stable prefixes that could have been reused from cache.

## Layout

```
qwicks/
  src/
    cli/         Command-line entrypoints (serve, run, chat, exec)
    contracts/   Zod schemas and inferred types for the HTTP/SSE contract
    domain/      Thread, Turn, Item, Event, Approval, Usage entities
    ports/       ModelClient, ToolHost, stores, EventBus, ApprovalGate, ...
    adapters/    DeepSeek-compatible model client, local tool host,
                 in-memory and file-backed stores, workspace inspector
    services/    Thread and turn orchestration services
    loop/        The cache-first agent loop and inflight helpers
    cache/       LRU / TTL caches and immutable prefix utilities
    telemetry/   Usage, cache, and cost counters
    server/      HTTP routing, auth, SSE, response helpers
  tests/         Cross-cutting contract tests
  dist/          Build output (gitignored)
```

## Scripts

Run from the `qwicks/` directory.

- `npm run typecheck` – run the package typecheck (no emit).
- `npm run test` – run Vitest unit and contract tests.
- `npm run build` – emit ESM JavaScript and type declarations into `dist/`.
- `npm run serve` – start the runtime after a build.
- `npm run dev` – rebuild in watch mode.

## CLI

`qwicks serve` accepts the following flags:

| Flag | Description | Default |
| --- | --- | --- |
| `--config` | JSON config file. If omitted, QWicks reads `{--data-dir}/config.json` when present | optional |
| `--host` | Bind address | `127.0.0.1` |
| `--port` | HTTP port | `8899` |
| `--data-dir` | Root directory for threads, events, and usage | required |
| `--runtime-token` | Bearer token for `/v1/*` requests | empty |
| `--api-key` | DeepSeek-compatible API key | empty |
| `--base-url` | DeepSeek-compatible model API base URL | `https://api.deepseek.com/beta` |
| `--model` | Default model id | `deepseek-v4-pro` |
| `--approval-policy` | `on-request` \| `untrusted` \| `never` \| `auto` \| `suggest` | `auto` |
| `--sandbox-mode` | `read-only` \| `workspace-write` \| `danger-full-access` \| `external-sandbox` | `workspace-write` |
| `--insecure` | Disable bearer token check (local dev only) | off |

Example:

```bash
qwicks serve \
  --config ~/.deepseekgui/qwicks/config.json \
  --host 127.0.0.1 \
  --port 8899 \
  --data-dir ~/.deepseekgui/qwicks \
  --runtime-token dev-token \
  --api-key "$DEEPSEEK_API_KEY" \
  --model deepseek-v4-pro
```

QWicks can also run as a standalone agent without the GUI:

```bash
qwicks run --data-dir ~/.deepseekgui/qwicks --workspace "$PWD" "summarize this repo"
qwicks chat --data-dir ~/.deepseekgui/qwicks --workspace "$PWD"
qwicks exec --data-dir ~/.deepseekgui/qwicks --workspace "$PWD" --list-tools
qwicks exec --data-dir ~/.deepseekgui/qwicks --workspace "$PWD" read --args '{"path":"README.md"}'
```

- `qwicks run` creates a thread, runs one turn, streams assistant text, and exits.
- `qwicks chat` starts a line-oriented REPL. Use `/exit`, `/quit`, or an empty line to stop.
- `qwicks exec --list-tools` prints the effective dynamic tool registry for the chosen config/workspace.
- `qwicks exec <tool> --args <json>` invokes one tool directly. Use `--json` on `run` or `exec` for machine-readable output.

## Environment variables

The runtime reads these from `process.env` when not set via CLI flags.

- `QWICKS_CONFIG` – explicit JSON config file
- `QWICKS_HOST` – bind host (overrides `--host` if set)
- `QWICKS_PORT` – bind port (overrides `--port` if set)
- `QWICKS_DATA_DIR` – root data directory (overrides `--data-dir` if set)
- `QWICKS_RUNTIME_TOKEN` – bearer token (overrides `--runtime-token` if set)
- `QWICKS_BASE_URL` – model API base URL (overrides `--base-url` if set)
- `DEEPSEEK_BASE_URL` – fallback model API base URL
- `QWICKS_MODEL` – default model id (overrides `--model` if set)
- `DEEPSEEK_API_KEY` – the DeepSeek API key the adapter forwards
  to the upstream model. Required at runtime for the default
  model client.

## Config file

QWicks supports a JSON config file so runtime behavior can be managed
without rebuilding or hard-coding loop thresholds.

Config resolution order is:

1. Built-in defaults.
2. JSON config file.
3. Environment variables.
4. CLI flags.

Use `--config <path>` or `QWICKS_CONFIG=<path>` for an explicit file. If
no explicit config is provided and `--data-dir` / `QWICKS_DATA_DIR` is set,
QWicks also reads `{data-dir}/config.json` when it exists. In the GUI's
default setup this is:

```text
~/.deepseekgui/qwicks/config.json
```

Shape:

```json
{
  "serve": {
    "host": "127.0.0.1",
    "port": 8899,
    "dataDir": "~/.deepseekgui/qwicks",
    "runtimeToken": "",
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com/beta",
    "model": "deepseek-v4-pro",
    "approvalPolicy": "auto",
    "sandboxMode": "workspace-write",
    "storage": {
      "backend": "hybrid"
    },
    "insecure": false
  },
  "contextCompaction": {
    "defaultSoftThreshold": 96000,
    "defaultHardThreshold": 108800,
    "summaryMode": "heuristic",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 1200,
    "summaryInputMaxBytes": 98304
  },
  "models": {
    "profiles": {
      "deepseek-v4-pro": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        }
      },
      "deepseek-v4-flash": {
        "aliases": ["deepseek-chat", "deepseek-reasoner"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        }
      }
    }
  },
  "capabilities": {
    "mcp": {
      "enabled": false,
      "servers": {
        "github": {
          "enabled": true,
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": { "GITHUB_TOKEN": "<github-token>" },
          "trustScope": "workspace",
          "trustedWorkspaceRoots": ["/path/to/workspace"],
          "timeoutMs": 30000
        },
        "remote-docs": {
          "enabled": false,
          "transport": "streamable-http",
          "url": "https://mcp.example.com/mcp",
          "headers": { "authorization": "Bearer <docs-mcp-token>" },
          "trustScope": "user",
          "timeoutMs": 30000
        }
      }
    },
    "web": {
      "enabled": false,
      "fetchEnabled": false,
      "searchEnabled": false,
      "provider": "fetch",
      "allowDomains": [],
      "denyDomains": ["localhost", "127.0.0.1"]
    },
    "skills": {
      "enabled": false,
      "roots": ["~/.agents/skills", "./.agents/skills"],
      "legacySkillMd": true
    },
    "subagents": {
      "enabled": false,
      "maxParallel": 2,
      "maxChildRuns": 4
    },
    "attachments": {
      "enabled": false,
      "maxImageBytes": 5242880,
      "maxImageDimension": 4096,
      "allowedMimeTypes": ["image/png", "image/jpeg", "image/webp"],
      "textFallbackMaxBase64Bytes": 524288,
      "textFallbackMaxImageDimension": 1280,
      "textFallbackPreferredMimeType": "image/webp"
    },
    "memory": {
      "enabled": false,
      "scopes": ["user", "workspace", "project"],
      "maxInjectedRecords": 8
    }
  }
}
```

QWicks defaults to hybrid session storage: `threads/{threadId}/messages.jsonl`
and `events.jsonl` remain the canonical transcript/replay logs, while
`index.sqlite3` stores only rebuildable thread metadata for fast lists
and search. Set `serve.storage.backend` to `"file"` to use the legacy
JSON index backend, or set `serve.storage.sqlitePath` to override the
default `{dataDir}/index.sqlite3` path.

Model-specific context windows, capabilities, and compaction thresholds
belong in `models.profiles`. Built-in profiles already cover
`deepseek-v4-pro`, `deepseek-v4-flash`, and the compatibility aliases
`deepseek-chat` / `deepseek-reasoner`; DeepSeek V4 defaults to a 1M
context window and starts compaction around 980k input tokens.
The legacy `contextCompaction.modelProfiles` location is still read for
backward compatibility, but new configs should use `models.profiles`.
See `../docs/QWICKS_CONFIG.md` for the detailed file layout and examples.

Feature flags are intentionally explicit:

- `capabilities.mcp` starts configured MCP clients and imports their tools into the dynamic registry. Workspace-scoped servers require `trustedWorkspaceRoots`.
- `serve.mcpSearch` can collapse a large MCP catalog into four entry points: `mcp_search`, `mcp_describe`, `mcp_call`, and `mcp_refresh_catalog`. When the catalog is too large, the model searches for relevant tools first, then describes and calls the exact tool instead of carrying every MCP schema on every turn.
- `serve.tokenEconomy` / `tokenEconomyMode` compresses tool descriptions, tool results, and history context while preserving code, paths, commands, URLs, errors, and other high-value signals.
- `contextCompaction` controls fallback long-thread compaction thresholds and summary behavior. Per-model thresholds live in `models.profiles`. Compaction preserves goals, constraints, decisions, touched files, tool outcomes, and unresolved next steps.
- `serve.runtimeTuning.toolStorm` suppresses repeated identical tool calls within a turn so useless tool loops do not keep spending tokens.
- `runtime.streamIdleTimeoutMs` (top-level in `config.json`) caps the idle gap between streaming chunks before a turn fails with `stream_idle_timeout` (default `45000`). Raise it for local model servers that stay silent while prefilling a very large prompt; set `0` to disable the guard.
- `capabilities.web` exposes `web_fetch` and/or `web_search`. The built-in provider can fetch HTTP(S) pages; search requires a provider implementation and may report unavailable.
- `capabilities.skills` scans configured roots for `skill.json` manifests and, when `legacySkillMd` is true, older `SKILL.md` directories.
- `capabilities.attachments` stores image bytes outside thread logs and allows turns to reference `attachmentIds`. Vision-capable models receive image parts; text-only models receive a bounded compressed base64 text fallback.
- `capabilities.memory` stores long-term records under the data dir, retrieves scoped matches before turns, and exposes `memory_create`, `memory_update`, and `memory_delete` tools.
- `capabilities.subagents` exposes `delegate_task` with `maxParallel` and `maxChildRuns` concurrency budgets.

Use `GET /v1/runtime/info` for the runtime capability manifest and
`GET /v1/runtime/tools` for redacted provider diagnostics. The GUI
Settings page reads both routes.

## Hooks

Hooks let external commands observe and intervene in the agent
lifecycle without rebuilding QWicks. They are configured under the
top-level `hooks` key in `config.json` (so the GUI's
`~/.deepseekgui/qwicks/config.json` works out of the box) and run inside
the serve runtime — main loop, subagents, and CLI alike.

```json
{
  "hooks": [
    {
      "phase": "PreToolUse",
      "matcher": "bash|write_file|mcp__*",
      "command": "node ~/.qwicks-hooks/guard.js",
      "timeoutMs": 10000
    },
    { "phase": "UserPromptSubmit", "command": "~/.qwicks-hooks/prompt-context.sh" },
    { "phase": "TurnEnd", "command": "~/.qwicks-hooks/notify.sh" }
  ]
}
```

Phases:

- `PreToolUse` — before every tool call. May rewrite `arguments`, deny
  the call, or auto-approve it (skip the approval prompt).
- `PostToolUse` — after every tool call. May replace `output` or mark
  the result as an error.
- `UserPromptSubmit` — before the first model step of a turn. May deny
  the turn or inject `additionalContext`, which is persisted as an
  extra `<hook-context>` user message.
- `TurnStart`, `TurnEnd`, `PreCompact` — observe-only notifications.
  Failures surface as `hook_warning` runtime events and never break
  the turn.

Matching: `matcher` is a glob over the tool name (`*` wildcard, `|`
alternation); `toolNames` is an exact-name list. Either match runs the
hook; omit both to run on every tool. Lifecycle phases ignore matchers.

Command protocol: the hook receives the invocation as JSON on stdin
(`phase` plus phase-specific fields such as `call`, `result`, `prompt`,
`status`, `reason`). Exit `0` parses stdout as a JSON result
(`{"decision":"deny"}`, `{"arguments":{...}}`, `{"output":...}`,
`{"additionalContext":"..."}`); plain-text stdout becomes
`additionalContext` for `UserPromptSubmit` and a message elsewhere.
Exit `2` blocks the action with stderr as the reason. Any other exit
code is a non-blocking `hook_warning`. The default timeout is 60s
(`timeoutMs` overrides); a timed-out hook fails the tool call closed
but never blocks observe-only phases.

Hooks chain in declaration order: each hook sees the call or result as
rewritten by the hooks before it. Embedders that assemble the runtime
programmatically can also pass in-process function hooks via the
`hooks` option of `LocalToolHost` and `AgentLoop` (exported from
`qwicks/hooks`).

Command hooks execute arbitrary shell commands with the runtime's
privileges — treat `config.json` as trusted input.

See `../docs/qwicks-hooks.en.md` for the full reference: per-phase stdin
payloads, result fields, failure semantics, and example hook scripts.

## Data directory layout

`--data-dir` is the on-disk root for everything the runtime owns:

```
{--data-dir}/
  config.json      # Optional QWicks runtime config
  attachments/     # Image metadata + content blobs when enabled
  memory/          # Long-term memory records and tombstones when enabled
  child-runs/      # Delegated child run records when subagents are enabled
  threads/
    index.json
    {threadId}/
      thread.json     # ThreadRecord
      messages.jsonl  # TurnItem append-only
      events.jsonl    # RuntimeEvent append-only
      session.json    # Latest AgentSession projection
      usage.json      # Per-thread usage snapshot
```

Atomic JSON writes are used for `index.json`, `thread.json`, and
`session.json`. JSONL streams are append-only and tolerate malformed
lines (the next replay skips them). The renderer can re-read a
thread by listing `index.json` and replaying the per-thread JSONL.

## HTTP API

The HTTP server exposes the following routes under `/v1/*`:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | unauthenticated health probe |
| GET | `/v1/runtime/info` | runtime metadata and capability manifest |
| GET | `/v1/runtime/tools` | redacted dynamic tool/provider diagnostics |
| GET | `/v1/workspace/status?path=...` | workspace git/branch status |
| GET | `/v1/threads?include=side` | list threads (most recently updated first); side threads are hidden unless `include=side` is passed |
| POST | `/v1/threads` | create a thread |
| GET | `/v1/threads/{id}` | read a thread with its turns |
| PATCH | `/v1/threads/{id}` | update title/status/approval/sandbox/relation (promote a side thread by setting `relation: "primary"`) |
| DELETE | `/v1/threads/{id}` | delete a thread |
| POST | `/v1/threads/{id}/fork` | fork the thread. Optional JSON body: `{ "relation": "fork" \| "side", "title"?: string }` (defaults to `fork` when omitted). `relation: "side"` marks the result as a side conversation and tags `parentThreadId`. |
| POST | `/v1/threads/{id}/turns` | start a turn |
| GET | `/v1/threads/{id}/turns/{turnId}` | read a single turn |
| POST | `/v1/threads/{id}/turns/{turnId}/steer` | queue steering text |
| POST | `/v1/threads/{id}/turns/{turnId}/interrupt` | abort a turn |
| POST | `/v1/threads/{id}/compact` | fold old history |
| GET | `/v1/threads/{id}/events?since_seq=N` | SSE backlog + live |
| POST | `/v1/approvals/{approvalId}` | allow/deny |
| POST | `/v1/attachments` | upload an image attachment as base64 |
| GET | `/v1/attachments/diagnostics` | attachment store status |
| GET | `/v1/attachments/{id}` | attachment metadata |
| GET | `/v1/attachments/{id}/content?thread_id=...&workspace=...` | authorized attachment bytes as base64 |
| GET | `/v1/memory?workspace=...&include_deleted=false` | list memory records in scope |
| POST | `/v1/memory` | create a memory record |
| GET | `/v1/memory/diagnostics` | memory store status |
| PATCH | `/v1/memory/{id}` | update, disable, or retag a memory record |
| DELETE | `/v1/memory/{id}` | tombstone a memory record |
| GET | `/v1/usage` | cumulative token/cache/turn counters |

SSE events use `id: <seq>`, `event: <kind>`, and JSON `data:`. A
late-joining client passes `since_seq` to receive the backlog before
live events flow.

`POST /v1/threads/{id}/turns` accepts `attachmentIds` alongside
`prompt`, `model`, `mode`, and `guiPlan`. Attachments are resolved
against the turn thread/workspace and are never embedded into
thread JSONL logs. Runtime events may include optional child-agent
metadata, web citations/sources, attachment ids, active Skill ids,
and injected memory ids; older clients can ignore these fields.

## Thread record

Each thread persisted under `{data-dir}/threads/{id}/thread.json` is a
`ThreadRecord` with the following relation metadata:

- `relation`: discriminator describing how the thread relates to its
  origin. One of `primary` (default), `fork` (a manual fork that
  switches you away), or `side` (a "by-the-way" side conversation
  inherited from a parent snapshot).
- `parentThreadId`: live parent link for `fork` and `side` threads;
  absent for primary threads. Cleared automatically when promoting a
  side thread back to `primary` via `PATCH /v1/threads/{id}`.
- `forkedFromThreadId` / `forkedFromTitle` / `forkedAt` /
  `forkedFromMessageCount` / `forkedFromTurnCount`: lineage metadata
  copied from the parent for forks and side conversations.

The default `GET /v1/threads` listing excludes `relation: "side"`
threads to keep the main thread list uncluttered. Pass
`?include=side` to opt in.

## Migration notes

Legacy Skill folders that only contain `SKILL.md` continue to work
when `capabilities.skills.legacySkillMd` is true. New Skills should
prefer a `skill.json` manifest with explicit `id`, `description`,
trigger metadata, instruction file, and allowed tool list; this makes
activation and diagnostics deterministic. A safe migration path is:

1. Keep the existing `SKILL.md`.
2. Add a `skill.json` next to it that points at the same instructions.
3. Restart QWicks or refresh diagnostics.
4. Once `/v1/runtime/tools` reports the Skill without validation
   errors, decide whether to keep legacy compatibility enabled.

Existing thread-level `pinnedConstraints` are not converted into
long-term memory automatically. They remain part of compaction items
and replay exactly as before. If a constraint should become
cross-thread recall, create an explicit memory record through the
GUI memory review surface or the `memory_create` tool. If it should
stay local to one thread, leave it as a pinned constraint.

## Troubleshooting

- MCP server does not appear: check `capabilities.mcp.enabled`, the
  server `enabled` flag, transport-specific fields (`command` for
  `stdio`, `url` for HTTP/SSE), `trustedWorkspaceRoots` for
  workspace-scoped servers, and `/v1/runtime/tools` for redacted
  `lastError` diagnostics.
- Web tools are missing: `capabilities.web.enabled` must be true and
  at least one of `fetchEnabled` / `searchEnabled` must be true.
  Built-in fetch handles HTTP(S) pages; search may still be
  unavailable when no provider implementation is configured.
- Image upload succeeds but the turn fails: check `maxImageBytes`,
  `maxImageDimension`, `allowedMimeTypes`, and the text fallback limits.
  Text-only models need a compressed fallback small enough to fit
  `textFallbackMaxBase64Bytes`.
- Memory is not injected: enable `capabilities.memory`, confirm
  `/v1/memory/diagnostics.enabled`, make sure records are in the
  selected workspace scope and not disabled/deleted, then inspect
  `lastInjectedIds`.
- `qwicks run`, `qwicks chat`, or `qwicks exec` cannot authenticate or load
  config: pass the same `--config`, `--data-dir`, `--api-key`,
  `--base-url`, and `--runtime-token` values used by `qwicks serve`.
  `qwicks exec --list-tools --json` is the quickest way to verify the
  effective tool registry for a CLI environment.
- A capability reports `disabled`: that normally means the config flag
  is false. A capability reports `unavailable`: the flag is true, but
  the backing provider/store/model is absent or failed initialization.

## GUI integration

After the legacy provider retirement, the desktop app main process
starts QWicks through `qwicks-process.ts` and routes all
`runtimeRequest` calls to the active base URL with a bearer token.
The renderer uses the same `AgentProvider` interface as the legacy
CodeWhale provider because QWicks speaks the same HTTP/SSE
contract. Settings live under `agents.qwicks` in
`AppSettingsV1` and include `binaryPath`, `port`, `autoStart`,
`apiKey`, `baseUrl`, `runtimeToken`, `dataDir`, `model`,
`approvalPolicy`, `sandboxMode`, and `insecure`.

The renderer also consumes the extension routes added for the larger
agent surface: `/v1/runtime/info`, `/v1/runtime/tools`,
`/v1/attachments/*`, and `/v1/memory/*`. Composer image controls are
enabled only when both the runtime attachment capability and model
image modality are available. Settings diagnostics display MCP
servers, Skill roots, web provider state, attachment store state,
memory records, and the live capability manifest.

Legacy persisted settings (`agentProvider: "codewhale"` or
`"reasonix"`) are migrated by `migrateLegacyAppSettings`.
Legacy credentials, base URLs, ports, and model selections seed
`agents.qwicks`; the saved settings file no longer keeps live
CodeWhale or Reasonix agent entries.

## Dream Memory System

The Dream Memory System (`src/dream/`) is a long-term, semantic memory
backend that learns from chat history, explicit saves, files, and connected
apps (Gmail/Drive), then uses that context to personalize answers, rewrite
search queries, and run background consolidation ("dreaming"). It is enabled
by setting `capabilities.memory.backend = 'dream'` in the runtime config.

### Data model

Every memory is a `MemoryItem` (`src/dream/types.ts`) with:

- **Identity**: `id`, `userId`, `type` (goal/skill/project/preference/
  constraint/fact/episode/feedback), `scope`, `tags`, `content`.
- **v3 strict fields**: `normalizedFacts[]`, `sourceIds[]`,
  `temporalState` (planned/current/occurred/expired/superseded),
  `validFrom`/`validUntil`, `supersedes[]`/`supersededBy[]`,
  `isTopOfMind`, `isSuppressed`, `userCorrected`, `salience`,
  `topic`, `lastUsedAt`, `sensitivity`, `shareable`.
- **Lifecycle**: a 9-state machine (`active`/`suppressed`/`expired`/
  `superseded`/`deleted`/`connector_revoked`/`archived`/`hypothesis`/
  `confirmed`) with append-only `statusHistory`.

Three first-class entities back provenance and control:

- **`SourceRecord`** — a separate row per source (chat turn, file, Gmail
  message, custom instruction, saved memory, Drive file) with `externalRef`
  for idempotent ingest. Memories reference sources via `sourceIds`.
- **`SuppressionRule`** — a "Don't mention this again" rule with scope
  `memory`/`source`/`summary`/`topic`. Suppress ≠ delete: the data stays,
  but the memory is excluded from proactive mentions (users can still ask
  explicitly).
- **`DerivationRecord`** — the dependency graph for synthesized memories.

### The 12-stage chat loop

`DreamMemorySystem.chat()` (`src/dream/chat/pipeline.ts`) runs:

1. **temporary check** — zero side-effects (no memory, no chat log, no source)
2. **opt-out check** — disabled users are fully invisible
3. **save chat** + create/reuse a chat `SourceRecord`
4. **extract** (LLM → heuristic fallback) → candidate drafts
5. **sanitize** (PII redact / injection quarantine / reject)
6. **persist drafts** (embed → conflict-resolve → store), linking to the
   source via `sourceIds` and inferring `temporalState` from content
7. **retrieve** (5-channel hybrid: vector / BM25 / exact / recency /
   importance, with 4 hard gates)
8. **ObservableGate** (judicious demote / freshness boost / user correction)
9. **suppression filter** — drop MEMORY/TOPIC-suppressed hits
10. **SelectiveInjectionRouter** (5-D: intent / relevance / risk / utility /
    budget) — irrelevant queries get zero injection
11. **query rewrite** — slot-fill diet/location/preferences for search/tools
12. **twin build + synthesize + prompt build** → reply, then **dreaming**
    marks the user dirty for background consolidation

`ChatResult` exposes `statusHints` (`remembering`, `personalizing`,
`memorySourcesUsed`, `rewrittenQueryFromMemory`) per the document's §12.

### Dreaming pipeline

`DreamingScheduler.tick()` (`src/dream/refresh/`) runs four stages:

- **`MemoryDecay`** — `expiresAt` passed → lifecycle `EXPIRED`; stale →
  importance demotion.
- **`MemoryReinforcement`** — retrieved memories get importance boosts.
- **`TemporalDreamer`** (v3) — `PLANNED` memories whose `validUntil` has
  passed are converted to `OCCURRED` with historized content
  ("I am going to visit Singapore" → "I visited Singapore…"). `CURRENT`
  memories past `validUntil` become `temporal_state=expired`.
- **`TopOfMindBalancer`** (v3) — promotes high-salience/recency/usage
  memories to `isTopOfMind`, demotes stale ones, caps the pool.

The scheduler auto-ticks in a microtask after each chat that writes new
memories, and can run on an interval via `start(intervalMs)`. Every
transition writes an explainable change log to `memory_event`.

### Controls & privacy

`MemoryControls` (`src/dream/controls/api.ts`) exposes:

- **Saved memory CRUD**: list (filter/search), get, edit (version snapshots),
  delete (soft/hard), version history, restore by version.
- **Suppression**: `suppress` (≠ delete, idempotent), `unsuppress`
  (deactivate), `deleteSuppression` (physical removal), `isSuppressed`.
- **Sources**: `upsertSource` (idempotent by externalRef), `getSource`,
  `listSources`, `deleteSource`, `deleteSourceAndDerived` (cascade:
  removes source + all derived inferred memories, preserves user-saved),
  `memoriesDerivedFromSource`.
- **Temporal**: `markOccurred` (manual planned→occurred).
- **Reference chat history**: `disableReferenceChatHistory` (removes
  chat-inferred memories, keeps saved memories + raw chat log).
- **Opt-out / export / purge**: full data lifecycle.

All operations are exposed over HTTP under `/v1/dream/*` (see
`src/server/routes/dream.ts`): `summary`, `ledger`, `memory/:id/versions`,
`memory/:id/restore`, `memory/:id/suppress`, `opt-out`, `opt-in`,
`export`, `purge`, `pulse`, `ingest/gmail`, `ingest/drive`,
`revoke-connector`, plus v3 routes `sources`, `sources/:id`,
`sources/:id/lineage`, `sources/:id` (DELETE cascade), `suppressions`,
`suppressions/unsuppress`, `suppressions/:id` (DELETE),
`memory/:id/mark-occurred`, `disable-reference-chat-history`.

### Running the dreaming pipeline

```bash
# From qwicks/ — run the full dream test suite (includes stress + acceptance)
.tools/test.sh src/dream/

# Type-check the dream module
.tools/typecheck.sh

# Run only the acceptance suite (maps to the 10 document criteria)
.tools/test.sh src/dream/acceptance.test.ts
```

Programmatically, to trigger dreaming for a user:

```typescript
import { DreamMemorySystem } from './dream/chat/pipeline.js'
const system = new DreamMemorySystem({ dataDir: './data' })
await system.chat('alice', 'remember I am vegan')  // writes + marks dirty
system.scheduler.tick({ userId: 'alice' })          // runs decay + temporal + top-of-mind
```

### Viewing / editing / deleting memories

```typescript
const controls = system.controls2
controls.listMemories('alice')                       // list (excludes deleted)
controls.listMemories('alice', { search: 'vegan' })  // search
controls.editMemory('mem_1', { content: 'updated' }) // edit (versioned)
controls.deleteMemory('mem_1')                        // soft delete
controls.versionHistory('mem_1')                      // audit history
controls.suppress({ userId: 'alice', scope: 'memory', target: 'mem_1' })
controls.deleteSourceAndDerived('src_1', { hard: true })  // cascade
```

### Test coverage

- `src/dream/types.test.ts` — data model + v3 fields round-trip.
- `src/dream/storage/repository.test.ts` — SQLite CRUD + migrations.
- `src/dream/controls/api.test.ts` — controls + cascade + suppression.
- `src/dream/refresh/*.test.ts` — decay, temporal dreamer, top-of-mind.
- `src/dream/chat/pipeline*.test.ts` — 12-stage loop + gating + v3.
- `src/dream/evaluation/stress.test.ts` — 300 generated cases
  (mixed/adversarial/seeded) with PII + injection safety gates.
- `src/dream/acceptance.test.ts` — 14 end-to-end tests mapping 1:1 to
  the document's 10 acceptance criteria.

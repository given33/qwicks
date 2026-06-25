# Dream Memory Batch E — Connectors UX + OAuth Security + Rewrite Privacy Filter

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** (1) Rewriter slot privacy filter — health/financial/identity categories never enter external search queries (Batch B bridge), location allowed (the doc's signature feature). (2) OAuth security — production refuses the default key, `safeStorage` backed key storage. (3) Connector UX — revoke-preview surface (the real Connect/Disconnect GUI + OAuth loop is a separate IPC-heavy effort; this batch delivers the backend `revokeConnector({preview})` + the rewriter filter + the OAuth hardening, which are fully unit-testable; the Electron OAuth flow is wired as a thin main-process handler left for live integration).

**Architecture:** Three independent, unit-testable units:
- `isSlotShareable(memory)` pure predicate in `query_rewrite/rewriter.ts` — reuses Batch B's `sensitivityCategories`; connector-source content blocked by provenance.
- `OAuthStore` production guard — `isUsingDefaultKey()` + non-dev → refuse to start/save (extend existing `DREAM_OAUTH_PRODUCTION` guard to a hard gate, not just a save block).
- `revokeConnector({preview})` in `connectors/api.ts` — preview returns affected-count; execute tombstones.

**Tech Stack:** TypeScript, vitest. Existing: `oauth.ts` (`OAuthTokenStore`, `isUsingDefaultKey`, `DREAM_OAUTH_PRODUCTION`), `gmail.ts`/`drive.ts`, `PermissionRevocation`, `rewriter.ts` (`isSafeForExternalSearch`).

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §5 (Batch E). Depends on Batch B (`sensitivityCategories`).

**Env note:** Run qwicks tests with Node 22: `export PATH="/c/Users/given/node22:$PATH"`.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `qwicks/src/dream/query_rewrite/rewriter.ts` | Modify | `isSlotShareable` predicate + slot gate |
| `qwicks/src/dream/query_rewrite/rewriter.test.ts` | Modify | sensitivity/connector slot tests |
| `qwicks/src/dream/connectors/oauth.ts` | Modify | Hard production gate (refuse start, not just save) |
| `qwicks/src/dream/connectors/oauth.test.ts` | Modify | production-gate tests |
| `qwicks/src/dream/connectors/api.ts` | Create | `revokeConnector({preview})` + `listConnectors` |
| `qwicks/src/dream/connectors/api.test.ts` | Create | revoke preview/execute tests |

---

## Task 1: Rewriter slot privacy filter (TDD)

**Files:**
- Modify: `qwicks/src/dream/query_rewrite/rewriter.ts`
- Modify: `qwicks/src/dream/query_rewrite/rewriter.test.ts`

The hook: before injecting a slot value from a memory, also gate on the source memory's `sensitivityCategories` (health/financial/identity → block) AND its connector provenance (private content → block). Location → allowed (signature feature).

- [ ] **Step 1: Add failing tests** to `rewriter.test.ts`

```ts
import { MemoryItem, MemoryLifecycleStatus, MemoryScope, MemoryType } from '../types.js'

function memWith(content: string, opts: { categories?: string[]; source?: string } = {}): MemoryItem {
  const m = new MemoryItem('m1', 'default', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  m.sensitivityCategories = opts.categories ?? []
  if (opts.source) m.provenance.source = opts.source as never
  return m
}

describe('rewriteQuery slot privacy (Batch E)', () => {
  it('health-category memory never contributes a slot', () => {
    const r = rewriteQuery({ userId: 'u', query: 'recommend a restaurant', memories: [memWith('I live in Paris and I am vegan', { categories: ['health'] })] })
    expect(r.rewritten).toBe('recommend a restaurant')
    expect(r.appliedMemories).toEqual([])
  })
  it('location-category-free memory contributes location slot (signature feature)', () => {
    const r = rewriteQuery({ userId: 'u', query: 'restaurants nearby', memories: [memWith('I live in Paris')] })
    expect(r.rewritten.toLowerCase()).toContain('paris')
  })
  it('connector-source private content does not enter query', () => {
    const r = rewriteQuery({ userId: 'u', query: 'restaurants nearby', memories: [memWith('I live in Paris', { source: 'gmail' })] })
    expect(r.rewritten).toBe('restaurants nearby')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run src/dream/query_rewrite/rewriter.test.ts` (the health/connector ones FAIL; location may already pass).

- [ ] **Step 3: Implement `isSlotShareable` + gate**

In `rewriter.ts`, add a predicate and use it at both slot-injection sites (lines ~79, ~87):

```ts
import type { MemoryItem } from '../types.js'
import { sanitizeForMemory } from '../security/sanitizer.js'

const SLOT_BLOCKED_CATEGORIES = new Set(['health', 'financial', 'identity'])
/** connector 来源标记 — 私有内容不得进外部搜索 query。 */
const CONNECTOR_SOURCES = new Set(['gmail', 'drive', 'file', 'connector'])

/**
 * Batch E(spec §5.3):一个 memory 能否贡献 slot 到外部搜索 query?
 * - sensitivityCategories ∩ {health,financial,identity} → 永不(slot 内容不得外泄)
 * - connector 来源(gmail/drive/file)私有内容 → 永不
 * - location 类(将来加入)→ 允许(这是文档招牌特性)
 * 仍叠加 isSafeForExternalSearch(PII/secret/injection)的二道过滤。
 */
function isSlotShareable(memory: MemoryItem): boolean {
  if ((memory.sensitivityCategories ?? []).some((c) => SLOT_BLOCKED_CATEGORIES.has(c))) return false
  if (CONNECTOR_SOURCES.has(String(memory.provenance?.source ?? ''))) return false
  return true
}
```

At both injection sites, change `if (diet && isSafeForExternalSearch(diet))` → `if (diet && isSlotShareable(mem) && isSafeForExternalSearch(diet))`, and likewise for `loc`.

- [ ] **Step 4: Run tests to verify they pass** — all rewriter tests green.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/query_rewrite/rewriter.ts qwicks/src/dream/query_rewrite/rewriter.test.ts
git commit -m "feat(dream): rewriter slot privacy filter (health/financial/identity + connector blocked, location allowed) (Batch E)"
```

---

## Task 2: OAuth hard production gate

**Files:**
- Modify: `qwicks/src/dream/connectors/oauth.ts`
- Modify: `qwicks/src/dream/connectors/oauth.test.ts`

Today `DREAM_OAUTH_PRODUCTION=true` blocks `save()` only. Extend: a `canStartConnectors()` predicate that returns false when `isUsingDefaultKey() && !isDev` — used to mark the capability unavailable (not just block a save mid-flight).

- [ ] **Step 1: Add failing tests** to `oauth.test.ts`

```ts
describe('production gate (Batch E)', () => {
  it('canStartConnectors returns false when using default key in production', () => {
    process.env.DREAM_OAUTH_PRODUCTION = 'true'
    delete process.env.DREAM_OAUTH_KEY
    const store = new OAuthTokenStore()
    expect(store.canStartConnectors()).toBe(false)
    delete process.env.DREAM_OAUTH_PRODUCTION
  })
  it('canStartConnectors returns true when a custom key is set', () => {
    process.env.DREAM_OAUTH_KEY = 'my-secret-key'
    const store = new OAuthTokenStore()
    expect(store.canStartConnectors()).toBe(true)
    delete process.env.DREAM_OAUTH_KEY
  })
  it('canStartConnectors returns true in dev (default key allowed for testing)', () => {
    delete process.env.DREAM_OAUTH_PRODUCTION
    delete process.env.DREAM_OAUTH_KEY
    const store = new OAuthTokenStore()
    expect(store.canStartConnectors()).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/dream/connectors/oauth.test.ts`.

- [ ] **Step 3: Implement `canStartConnectors`** in `oauth.ts` on `OAuthTokenStore`:

```ts
  /**
   * Batch E(spec §5.2):能否在当前环境启动 connector。
   * 生产模式 + 默认密钥 → 拒绝(明文存 token 不可接受)。
   * 默认 key 仅在非生产(dev/test)放行。
   */
  canStartConnectors(): boolean {
    const isProduction = process.env.DREAM_OAUTH_PRODUCTION === 'true'
    if (isProduction && this.usingDefaultKey) return false
    return true
  }
```

- [ ] **Step 4: Run to verify pass**.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/connectors/oauth.ts qwicks/src/dream/connectors/oauth.test.ts
git commit -m "feat(dream): OAuth canStartConnectors hard production gate (Batch E)"
```

---

## Task 3: `revokeConnector({preview})` + `listConnectors`

**Files:**
- Create: `qwicks/src/dream/connectors/api.ts`
- Create: `qwicks/src/dream/connectors/api.test.ts`

`listConnectors(userId)` returns connected accounts. `revokeConnector({preview:true})` returns how many memories would be tombstoned; `preview:false` executes the `PermissionRevocation` (tombstone propagation via CONNECTOR_REVOKED status).

- [ ] **Step 1: Write failing tests**

Create `qwicks/src/dream/connectors/api.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryItem, MemoryLifecycleStatus, MemoryScope, MemoryType } from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { ConnectorControls } from './api.js'

describe('ConnectorControls', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: ConnectorControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-conn-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'c.db') })
    controls = new ConnectorControls(repo)
  })
  afterEach(async () => { repo.close(); await rm(dir, { recursive: true, force: true }) })

  it('revokeConnector preview returns affected count without mutating', () => {
    const gmailItem = new MemoryItem('m1', 'default', MemoryType.FACT, 'flight info', MemoryScope.USER)
    gmailItem.provenance.source = 'gmail' as never
    repo.upsert(gmailItem)
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: true })
    expect(r.preview).toBe(true)
    expect(r.affectedCount).toBe(1)
    // not mutated
    expect(repo.get('m1')?.status).toBe(MemoryLifecycleStatus.ACTIVE)
  })

  it('revokeConnector execute tombstones affected memories', () => {
    const gmailItem = new MemoryItem('m1', 'default', MemoryType.FACT, 'flight info', MemoryScope.USER)
    gmailItem.provenance.source = 'gmail' as never
    repo.upsert(gmailItem)
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: false })
    expect(r.preview).toBe(false)
    expect(r.affectedCount).toBe(1)
    expect(repo.get('m1')?.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/dream/connectors/api.test.ts`.

- [ ] **Step 3: Implement** `qwicks/src/dream/connectors/api.ts`:

```ts
/**
 * Batch E(spec §5.1):Connector 控制层。
 * listConnectors:列出已连接账号;revokeConnector:撤销(preview 统计 / 执行 tombstone)。
 */
import type { MemoryRepository } from '../storage/repository.js'
import { MemoryLifecycleStatus, nowIso } from '../types.js'

export interface ConnectorAccount {
  provider: string
  account: string
  connectedAt: string
}

export interface RevokeResult {
  preview: boolean
  affectedCount: number
}

export class ConnectorControls {
  constructor(private readonly repository: MemoryRepository) {}

  revokeConnector(
    userId: string,
    provider: string,
    account: string,
    opts: { preview: boolean }
  ): RevokeResult {
    const items = this.repository.list(userId, {})
    // 受影响 = provenance.source === provider 的活跃记忆
    const affected = items.filter(
      (it) => String(it.provenance?.source ?? '') === provider && it.status === MemoryLifecycleStatus.ACTIVE
    )
    if (opts.preview) {
      return { preview: true, affectedCount: affected.length }
    }
    for (const it of affected) {
      it.transitionStatus(MemoryLifecycleStatus.SUPPRESSED, { actor: `connector_revoke:${provider}:${account}`, reason: 'CONNECTOR_REVOKED' })
      it.metadata.connector_revoked_at = nowIso()
      it.metadata.connector_revoked_provider = provider
      this.repository.upsert(it)
    }
    return { preview: false, affectedCount: affected.length }
  }
}
```

(`listConnectors` reads from the OAuthTokenStore — out of scope for the unit test since it needs live tokens; leave as a stub returning `[]` or wire when the OAuth store is injected.)

- [ ] **Step 4: Run to verify pass**.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/connectors/api.ts qwicks/src/dream/connectors/api.test.ts
git commit -m "feat(dream): ConnectorControls revokeConnector(preview/execute) (Batch E)"
```

---

## Task 4: Full verification

- [ ] `npx vitest run src/dream/` (Node 22) — all green, 492+ tests.
- [ ] `npx tsc --noEmit -p tsconfig.json` + `npm run build` — green.

Batch E complete when: rewriter blocks health/financial/identity + connector slots, allows location; OAuth refuses default key in production; revoke preview/execute works; tests + build green. (The Electron Connect/Disconnect GUI + live OAuth loop is a separate IPC effort, deferred per the note above.)

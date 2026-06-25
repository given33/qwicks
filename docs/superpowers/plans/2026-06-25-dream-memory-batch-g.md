# Dream Memory Batch G — Identity + Multi-device

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Remove hardcoded `'default'` userId from the agent-loop memory paths (B16 residual at lines 2707/2721/2754) so all memory reads/writes use the stable `this.memoryUserId`. Add a `MemoryIdentityResolver` (workspace→device→default fallback) and a pure dream-scope→mesh-scope mapper for the (deferred) mesh-sync path.

**Architecture:** Identity resolution stays at the call boundary (`opts.memoryUserId`), but every internal path must funnel through `this.memoryUserId` rather than re-deriving `'default'`. A tiny `MemoryIdentityResolver` documents the resolution order; `dreamScopeToMeshScope()` maps the (deferred) cross-device sync. The repo already keys all tables on `user_id` (no schema change) — isolation is query-level.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §7 (Batch G).

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `qwicks/src/dream/memory-identity-resolver.ts` | Create | `resolveMemoryUserId()` + `dreamScopeToMeshScope()` |
| `qwicks/src/dream/memory-identity-resolver.test.ts` | Create | resolver + scope-map tests |
| `qwicks/src/loop/agent-loop.ts` | Modify | replace `'default'` residuals with `this.memoryUserId` |

## Task 1: `MemoryIdentityResolver` + scope mapper (TDD)

- [ ] Create test + impl for `resolveMemoryUserId({workspaceUser?, deviceUser?})` → workspace→device→'default'; and `dreamScopeToMeshScope('user'|'workspace'|'project')` → 'private'|'public'|'collaboration'.
- [ ] Tests pass.
- [ ] Commit.

## Task 2: Fix agent-loop `'default'` residuals

- [ ] Lines 2707, 2721, 2754: replace `'default'` (and `input.userId ?? 'default'`) with `this.memoryUserId` (or `input.userId ?? this.memoryUserId`).
- [ ] Run loop tests; typecheck.
- [ ] Commit.

## Task 3: verification

- [ ] Full dream + root suites green.

# Codex-Style Turn Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P0 Codex-style QWicks timeline: semantic tool activity kinds, turn projection, and specialized process rows for command/file/web/MCP/dynamic/multi-agent tools.

**Architecture:** Keep QWicks' HTTP/SSE runtime and append-only session store. Add a compatibility-preserving `activityKind` contract that flows from tools to persisted items, mapper events, store blocks, and timeline grouping. Centralize UI decisions in pure projection/classification helpers before touching visual components.

**Tech Stack:** TypeScript, Zod, React 19, Zustand, Vitest, lucide-react, existing QWicks runtime contracts.

## Global Constraints

- Preserve existing `toolKind` behavior for old sessions.
- Prefer explicit `activityKind`; fall back to `providerKind`, `toolKind`, `toolName`, metadata, and sources.
- Do not copy reverse-engineered Codex code; implement behavior in QWicks style.
- Use TDD: write failing tests before production code for each behavior change.
- Keep P0 scoped to semantic lanes, turn projection, command/file/web details, and basic MCP/dynamic/multi-agent rows.
- Leave OTel span trees, full multi-agent side panels, and approval policy parity out of P0.

---

## File Structure

- `qwicks/src/contracts/items.ts`: add `ToolActivityKind` Zod enum and optional `activityKind` fields on tool items.
- `qwicks/src/ports/tool-host.ts`: expose `activityKind` on tool specs and tool calls.
- `qwicks/src/adapters/tool/local-tool-host.ts`: carry tool `activityKind` through list/execute/result/update paths.
- `qwicks/src/adapters/tool/capability-registry.ts`: include `activityKind` in advertised specs.
- `qwicks/src/loop/agent-loop.ts`: copy advertised `activityKind` into tool calls and persisted tool items.
- `src/renderer/src/agent/types.ts`: add renderer `ToolActivityKind`, `activityKind` on `ToolBlock` and `ToolEventPayload`.
- `src/renderer/src/agent/qwicks-contract.ts`: accept `activityKind` on core item/event JSON.
- `src/renderer/src/agent/qwicks-mapper.ts`: infer and propagate `activityKind`.
- `src/renderer/src/components/chat/tool-category.ts`: classify by `activityKind` first.
- `src/renderer/src/components/chat/render-groups.ts`: group by activity kind while preserving existing summaries.
- `src/renderer/src/components/chat/derive-turn-sections.ts`: expose a pure turn render model wrapper around existing section derivation.
- `src/renderer/src/components/chat/message-timeline-process.tsx`: render activity-specific labels/icons/details.
- `src/renderer/src/store/chat-store-runtime.ts` and `src/renderer/src/store/chat-store-side-actions.ts`: preserve `activityKind` during live updates.
- Tests beside each unit: `qwicks/src/contracts/*.test.ts` if present, `src/renderer/src/agent/qwicks-mapper.test.ts`, `tool-category.test.ts`, `render-groups.test.ts`, `derive-turn-sections.test.ts`, and timeline process tests.

## Task 1: Add ToolActivityKind Contract

**Files:**
- Modify: `qwicks/src/contracts/items.ts`
- Modify: `qwicks/src/ports/tool-host.ts`
- Modify: `qwicks/src/adapters/tool/local-tool-host.ts`
- Modify: `qwicks/src/adapters/tool/capability-registry.ts`
- Modify: `qwicks/src/loop/agent-loop.ts`
- Modify: `src/renderer/src/agent/types.ts`
- Modify: `src/renderer/src/agent/qwicks-contract.ts`
- Test: `src/renderer/src/agent/qwicks-mapper.test.ts`

**Interfaces:**
- Produces: `ToolActivityKind = 'command_execution' | 'file_change' | 'mcp_tool_call' | 'dynamic_tool_call' | 'multi_agent_action' | 'web_search' | 'generic_tool'`
- Produces: optional `activityKind?: ToolActivityKind` on backend tool items/specs/calls and renderer tool blocks/events.

- [ ] **Step 1: Write failing mapper tests**

Add tests that assert:

```ts
expect(chatBlockFromItem({
  id: 'item_mcp',
  turnId: 'turn_1',
  threadId: 'thr_1',
  role: 'tool',
  status: 'completed',
  createdAt: '2024-01-01T00:00:00.000Z',
  kind: 'tool_result',
  toolName: 'mcp_server_read',
  callId: 'call_mcp',
  toolKind: 'tool_call',
  activityKind: 'mcp_tool_call',
  output: { ok: true }
} as CoreTurnItemJson)).toMatchObject({
  kind: 'tool',
  toolKind: 'tool_call',
  activityKind: 'mcp_tool_call'
})
```

and tool events preserve `activityKind`.

- [ ] **Step 2: Run red test**

Run: `npm run test -- src/renderer/src/agent/qwicks-mapper.test.ts`

Expected: FAIL because `activityKind` is not mapped.

- [ ] **Step 3: Implement contract fields**

Add the union type/Zod enum, optional fields, and propagation through local tool host and agent loop. Built-in mapping:

```ts
bash -> command_execution
edit/write/create_plan -> file_change
web provider -> web_search
mcp provider -> mcp_tool_call
delegation provider -> multi_agent_action
image/audio/video/gui/skill/memory/computer-use style providers -> dynamic_tool_call
fallback -> generic_tool
```

- [ ] **Step 4: Run green tests**

Run: `npm run test -- src/renderer/src/agent/qwicks-mapper.test.ts`

Expected: PASS.

## Task 2: Centralize Activity Classification and Grouping

**Files:**
- Modify: `src/renderer/src/components/chat/tool-category.ts`
- Modify: `src/renderer/src/components/chat/render-groups.ts`
- Test: `src/renderer/src/components/chat/tool-category.test.ts`
- Test: `src/renderer/src/components/chat/render-groups.test.ts`

**Interfaces:**
- Consumes: `ToolBlock.activityKind`.
- Produces: classification helpers that group same consecutive `activityKind` and infer legacy blocks.

- [ ] **Step 1: Write failing classification tests**

Assert explicit `activityKind` wins over name/source heuristics, and legacy web sources still infer web.

- [ ] **Step 2: Run red tests**

Run: `npm run test -- src/renderer/src/components/chat/tool-category.test.ts src/renderer/src/components/chat/render-groups.test.ts`

Expected: FAIL on explicit `activityKind` expectations.

- [ ] **Step 3: Implement classifier**

Add activity-kind-first classification and update render group `ClassifiedUnit` to carry `activityKind`.

- [ ] **Step 4: Run green tests**

Run: `npm run test -- src/renderer/src/components/chat/tool-category.test.ts src/renderer/src/components/chat/render-groups.test.ts`

Expected: PASS.

## Task 3: Add TurnRenderModel Projection

**Files:**
- Modify: `src/renderer/src/components/chat/derive-turn-sections.ts`
- Test: `src/renderer/src/components/chat/derive-turn-sections.test.ts`

**Interfaces:**
- Produces: `deriveTurnRenderModel(input): TurnRenderModel`.
- Keeps `deriveTurnSections` compatible by building on the model or delegating through it.

- [ ] **Step 1: Write failing projection tests**

Assert:

- completed turns expose only the last assistant content block as `finalAssistantItems`;
- intermediate assistant narration stays in `workItems`;
- streaming `liveContent` is not duplicated in work items;
- pending approval/user input is separated and force-open eligible.

- [ ] **Step 2: Run red tests**

Run: `npm run test -- src/renderer/src/components/chat/derive-turn-sections.test.ts`

Expected: FAIL for missing `deriveTurnRenderModel`.

- [ ] **Step 3: Implement pure projection**

Implement `TurnRenderModel` without changing the current `MessageTimeline` markup yet. Wire `deriveTurnSections` through it only where behavior stays identical.

- [ ] **Step 4: Run green tests**

Run: `npm run test -- src/renderer/src/components/chat/derive-turn-sections.test.ts`

Expected: PASS.

## Task 4: Preserve Activity Kind in Live Store Updates

**Files:**
- Modify: `src/renderer/src/store/chat-store-runtime.ts`
- Modify: `src/renderer/src/store/chat-store-side-actions.ts`
- Test: `src/renderer/src/store/chat-store-runtime.test.ts`
- Test: `src/renderer/src/store/chat-store-side-actions.test.ts`

**Interfaces:**
- Consumes: `ToolEventPayload.activityKind`.
- Produces: live `ToolBlock.activityKind` survives insert and update.

- [ ] **Step 1: Write failing store tests**

Assert a running tool inserted from `onTool` has `activityKind`, and a later update preserves or replaces it correctly.

- [ ] **Step 2: Run red tests**

Run: `npm run test -- src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/store/chat-store-side-actions.test.ts`

Expected: FAIL because store drops `activityKind`.

- [ ] **Step 3: Implement store propagation**

Add `activityKind: ev.activityKind ?? cur.activityKind` on updates and `activityKind: ev.activityKind` on inserts for main and side conversations.

- [ ] **Step 4: Run green tests**

Run: `npm run test -- src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/store/chat-store-side-actions.test.ts`

Expected: PASS.

## Task 5: Render Specialized Activity Rows

**Files:**
- Modify: `src/renderer/src/components/chat/message-timeline-process.tsx`
- Modify: `src/renderer/src/components/chat/tool-activity-summary.ts`
- Test: `src/renderer/src/components/chat/group-process-sections.test.ts`
- Test: `src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts`

**Interfaces:**
- Consumes: `ToolBlock.activityKind` and existing metadata.
- Produces: activity-specific row labels/icons/details.

- [ ] **Step 1: Write failing UI logic tests**

Assert command/file/web/MCP/dynamic/multi-agent groups produce distinct section labels/categories and that command detail exposes command/output/exit status metadata.

- [ ] **Step 2: Run red tests**

Run: `npm run test -- src/renderer/src/components/chat/group-process-sections.test.ts src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts`

Expected: FAIL on new activity-specific expectations.

- [ ] **Step 3: Implement labels/details**

Use lucide icons already in the project. Keep styling compact: no nested cards, no oversized terminal panel. Web rows show source chips through existing `RuntimeMetaBadges`.

- [ ] **Step 4: Run green tests**

Run: `npm run test -- src/renderer/src/components/chat/group-process-sections.test.ts src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts`

Expected: PASS.

## Task 6: Verification and Commit

**Files:**
- All touched files.

- [ ] **Step 1: Run targeted suites**

Run:

```powershell
npm run test -- src/renderer/src/agent/qwicks-mapper.test.ts src/renderer/src/components/chat/tool-category.test.ts src/renderer/src/components/chat/render-groups.test.ts src/renderer/src/components/chat/derive-turn-sections.test.ts src/renderer/src/components/chat/group-process-sections.test.ts src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/store/chat-store-side-actions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run: `git diff --check`

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

Commit message: `feat: add codex-style tool activity lanes`.

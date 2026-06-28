# QWicks Native QQPet Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QWicks resolve QQPet actions from the original `C:/Users/given/Desktop/pet/` resource structure while keeping the existing Electron/React pet runtime stable.

**Architecture:** Add a generated source index for original QQPet resources and a shared resolver that maps QWicks stage/gender/mood/action requests to source assets. Keep current Unity-extracted PNG/JSON animations as fallback until SWF conversion is added.

**Tech Stack:** TypeScript, Vitest, Electron, React, PowerShell source inspection, existing MQPet shared modules.

## Global Constraints

- Do not commit raw Unity binaries from `C:/Users/given/Desktop/QQpet/`.
- Do not bundle raw SWF files into the production runtime in this batch.
- Treat `C:/Users/given/Desktop/pet/Action` as the source of truth for stage/gender/action coverage.
- Preserve the current MQPet FSM behavior while adding source-backed resource metadata.
- Use failing tests before production TypeScript changes.

---

### Task 1: Source Asset Types and Resolver

**Files:**
- Modify: `src/shared/mqpet-source-assets.test.ts`
- Modify: `src/shared/mqpet-source-assets.ts`

**Interfaces:**
- Produces: `MqPetSourceGender`, `MqPetSourceStage`, `MqPetSourceMood`, `MqPetSourceActionKind`, `MqPetSourceAssetRef`
- Produces: `sourceStageForLevel(level: number): MqPetSourceStage`
- Produces: `sourceMoodForPetState(state: Pick<MqPetState, 'level' | 'hunger' | 'cleanliness' | 'health' | 'mood'>): MqPetSourceMood`
- Produces: `resolveOriginalActionAsset(request): MqPetSourceAssetRef | null`

- [x] **Step 1: Write failing tests**

```ts
expect(sourceStageForLevel(1)).toBe('Egg');
expect(sourceStageForLevel(10)).toBe('Kid');
expect(sourceStageForLevel(30)).toBe('Adult');
expect(resolveOriginalActionAsset({ gender: 'GG', sourceStage: 'Egg', action: 'stand' })?.sourcePath)
  .toBe('Action/GG/Egg/Stand.swf');
expect(resolveOriginalActionAsset({ gender: 'MM', sourceStage: 'Adult', mood: 'peaceful', action: 'stand' })?.sourcePath)
  .toBe('Action/MM/Adult/peaceful/Stand.swf');
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run src/shared/mqpet-source-assets.test.ts`

- [x] **Step 3: Implement resolver and source index**

Add source asset types, a curated first-batch index for all stages/genders, and resolver fallback order.

- [x] **Step 4: Run focused tests**

Run: `npx vitest run src/shared/mqpet-source-assets.test.ts`

### Task 2: FSM Source Action Metadata

**Files:**
- Modify: `src/shared/mqpet-fsm.test.ts`
- Modify: `src/shared/mqpet-fsm.ts`

**Interfaces:**
- Produces: `sourceActionForFsm(s: MqPetFsm): MqPetSourceActionKind`

- [x] **Step 1: Write failing tests**

```ts
expect(sourceActionForFsm({ kind: 'Feed', animId: 0, elapsed: 0 })).toBe('eat');
expect(sourceActionForFsm({ kind: 'Clean', elapsed: 0 })).toBe('clean');
expect(sourceActionForFsm({ kind: 'Dying', phase: 'Bury', elapsed: 0 })).toBe('bury');
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run src/shared/mqpet-fsm.test.ts`

- [x] **Step 3: Implement mapping**

Map existing FSM states to original source action categories without changing animation playback yet.

- [x] **Step 4: Run focused tests**

Run: `npx vitest run src/shared/mqpet-fsm.test.ts`

### Task 3: Verification

**Files:**
- No production file changes.

**Interfaces:**
- Consumes: source resolver and FSM metadata from Tasks 1-2.

- [x] **Step 1: Run MQPet targeted tests**

Run: `npx vitest run src/shared/mqpet-source-assets.test.ts src/shared/mqpet-fsm.test.ts src/shared/mqpet-data.test.ts src/renderer-mqpet/src/spriteResolver.test.ts`

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`

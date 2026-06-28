# MQPet Unity Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the user's Unity QQPet project as the QWicks MQPet engine while Electron provides desktop-pet shell behavior that Unity WebGL cannot reliably own.

**Architecture:** Keep the existing Electron overlay window as the desktop shell and add a Unity WebGL runtime path inside the MQPet renderer. QWicks resolves a local Unity WebGL build, loads it in the existing transparent pet window, and exposes a bridge for pet hit boxes, dragging, menus, state commands, and Unity-to-QWicks events. The current React/SWF pet stays as a fallback until the Unity WebGL build is exported.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Unity WebGL build output from Unity 2022.3.53f1c1.

## Global Constraints

- Do not commit the 1.33GB Unity source archive or generated WebGL output into the repo.
- Preserve QWicks as one visible application; Unity is an internal MQPet engine, not a second user-facing app.
- Electron owns transparent desktop display, mouse passthrough, dragging, right-click menu, and hover menu behavior.
- Unity owns original QQPet UI, item data, bag/shop/status/game logic, animation state, and original art after the WebGL build is available.
- If Unity WebGL assets are missing, show a diagnostic fallback and keep the current MQPet renderer usable.

---

### Task 1: Unity WebGL Build Resolver

**Files:**
- Create: `src/main/mqpet-unity-build.ts`
- Test: `src/main/mqpet-unity-build.test.ts`
- Modify: `src/main/mqpet-ipc.ts`
- Modify: `src/preload/mqpet.ts`

**Interfaces:**
- Produces: `resolveMqpetUnityBuild(options): MqpetUnityBuildStatus`
- Produces: IPC handler `mqpet:get-unity-build`

- [ ] Write tests for environment override, default userData path, missing required files, and safe URL generation.
- [ ] Implement resolver without assuming a committed Unity build.
- [ ] Expose resolver through preload.
- [ ] Run `npx vitest run src/main/mqpet-unity-build.test.ts`.

### Task 2: Unity Runtime Host

**Files:**
- Create: `src/renderer-mqpet/src/UnityMqpetStage.tsx`
- Modify: `src/renderer-mqpet/src/main.tsx`
- Modify: `src/renderer/mqpet.html`
- Test: `src/renderer-mqpet/src/UnityMqpetStage.test.tsx`

**Interfaces:**
- Consumes: `window.mqpet.getUnityBuild()`
- Produces: `window.qwicksMqpetUnityBridge` for Unity `SendMessage`/JS plugin calls.

- [ ] Write tests for runtime selection and missing-build fallback.
- [ ] Load Unity loader script dynamically from the resolved build URL.
- [ ] Forward Unity-reported hit boxes and dragging to the existing Electron shell IPC.
- [ ] Run targeted renderer tests.

### Task 3: Desktop Shell Adaptation

**Files:**
- Modify: `src/main/mqpet-window.ts`
- Modify: `src/preload/mqpet.ts`
- Test: `src/main/mqpet-window-shell.test.ts`

**Interfaces:**
- Consumes: renderer `reportBBox`, `setDragging`, and menu requests.
- Produces: consistent click-through, focus, right-click, hover menu, and drag release behavior for Unity and fallback renderers.

- [ ] Extract shell interaction decisions into pure functions for tests.
- [ ] Keep overlay transparent, always-on-top, visible on all workspaces, and click-through outside the pet/menu hit areas.
- [ ] Verify drag release clears interactive mode so the pet cannot stick to the pointer.

### Task 4: Unity Source Export Hook

**Files:**
- Create: `tools/mqpet-source/export-unity-webgl.md`
- Create: `tools/mqpet-source/check-unity-webgl-build.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run mqpet:check-unity-webgl`

- [ ] Document Unity 2022.3.53f1c1 WebGL export settings and output directory.
- [ ] Add a verifier for `.loader.js`, `.framework.js`, `.wasm`, and `.data`.
- [ ] Run verifier against a missing build to confirm it reports actionable guidance.

### Task 5: Original Data Bridge

**Files:**
- Modify: `src/shared/mqpet-catalog.ts`
- Modify: `src/shared/mqpet-data.ts`
- Modify: `tools/mqpet-source/generate-catalog-from-sources.mjs`
- Test: `src/shared/mqpet-catalog.test.ts`
- Test: `src/shared/mqpet-data.test.ts`

**Interfaces:**
- Consumes: `Config.ini` and Unity `ItemData` assets.
- Produces: full QWicks-side item catalog for console/debug/fallback UI.

- [ ] Fix GB18030 decoding in the generator.
- [ ] Preserve Config goods/wash item prices and effects.
- [ ] Keep Unity-only medicine and special growth items.
- [ ] Apply original stat triples in the QWicks fallback state model.

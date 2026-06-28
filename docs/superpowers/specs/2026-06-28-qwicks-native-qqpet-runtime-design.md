# QWicks Native QQPet Runtime Design

## Goal

QWicks will run QQPet as an internal Electron/React feature, not as a visible Unity side application. The Unity package at `C:/Users/given/Desktop/QQpet/` stays as behavior reference. The original resource package at `C:/Users/given/Desktop/pet/` becomes the main source for pet actions, menus, status UI, audio, and future mini-games.

## Source Roles

- `C:/Users/given/Desktop/QQpet/`: Unity runtime reference. Use it for script names, state-machine behavior, timings, menu semantics, and extracted JSON/PNG fallback assets already present in `src/asset/img/mqpet`.
- `C:/Users/given/Desktop/pet/`: original QQPet resource library. Use `Action/GG|MM/Egg|Kid|Adult` for stage/gender animation resources, `Menu`, `stateInfo`, `img_res`, and `windowTip` for original UI, `music/main01.mp3` for audio, and `farm`, `fishing`, `smallGame`, `smallGamec1` for later gameplay reconstruction.

## Runtime Architecture

QWicks keeps the existing MQPet foundation:

- Electron main process owns the pet overlay window, state store, console window, and IPC.
- `src/shared/mqpet-fsm.ts` owns action state transitions such as idle, bored, interact, feed, clean, level-up, dying, dead, and revive.
- `src/renderer-mqpet` renders the transparent desktop pet overlay.
- `src/renderer-mqconsole` renders inventory, status, work, learning, and map panels.

The new layer is a source-backed asset resolver:

- A generated source index records all original `pet/Action` assets by gender, stage, mood, and action bucket.
- Runtime code resolves a semantic request such as `stage=Kid`, `gender=GG`, `mood=peaceful`, `action=stand` to an original source asset identity.
- The current Unity-extracted PNG/JSON animations remain a fallback while SWF conversion is phased in.

## Stages, Gender, and Mood

The runtime stage rules stay:

- Level `1-9`: `Egg`
- Level `10-29`: `Toddler`, backed by original `Kid` resources
- Level `30+`: `Mature`, backed by original `Adult` resources

Gender is represented as `GG` or `MM`. Default is `GG` until account/profile selection is implemented.

Mood is selected from pet stats:

- Health or mood critically low: `sad` or `prostrate`
- Hunger/cleanliness low: `upset`
- Good mood/high stats: `happy`
- Otherwise: `peaceful`

Egg and Kid assets do not have the Adult mood subfolders, so their resolver falls back to stage-level `Stand`, `Speak`, `play`, and `interact` files.

## Action Mapping

The resolver exposes original action categories:

- Lifecycle: `appear`, `enter`, `exit`, `first`, `hide`, `levelUp`
- Care: `eat`, `clean`, `cure`
- Health: `sick`, `dirty`, `hungry`, `dying`, `die`, `bury`, `revive`
- Idle and communication: `stand`, `speak`
- Interaction: `interact`, `play`

QWicks FSM actions map to source actions:

- Idle -> `stand`
- Bored -> non-repeating `play`
- Click interaction -> non-repeating `play` or `interact`
- Click during action -> `Question` fallback until original question resource is identified
- Feed -> random `Eat1`/`Eat2` where available
- Clean -> `Clean`/`Clean1`/`Clean2`
- Heal -> `Cure`/`Cure1`/`Cure2`
- Level up -> `LevUp`, with stage recomputed after the state update
- Die -> `Die`, then `Bury`
- Revive -> `Revival`

## SWF Strategy

Electron cannot natively play Flash-era SWF. The production direction is offline conversion:

- Keep raw SWF outside the runtime bundle during development.
- Generate a JSON manifest of source files first.
- Add a conversion pipeline that turns selected SWFs into PNG/WebP frame sequences plus animation manifests.
- Convert only boot/stand/idle/enter first, then interaction and care actions on demand.
- Runtime always consumes manifests through the asset resolver, so switching from fallback PNG to converted original SWF frames does not require FSM rewrites.

## UI and Gameplay Scope

Original-like UI will be rebuilt from `pet/Menu`, `stateInfo`, `img_res`, `windowTip`, and shop assets:

- Hover radial menu remains the desktop entry point.
- Feed, clean, and medicine open inventory categories.
- Status panel uses original stat names, iconography, and thresholds.
- Work, learning, farm, fishing, and small games are reconstructed inside QWicks windows using source configs and assets, not by launching external Flash or Unity apps.

The first implementation batch focuses on source indexing and runtime resource resolution. Later batches convert SWF frames, replace console panels with original UI assets, add audio/reminder rhythm, and rebuild work/learn/mini-game loops.

## Startup Performance

Startup must keep QWicks usable before MQPet finishes loading:

- Main window starts first.
- MQPet overlay is lazy-created after idle time or user enablement.
- Backend runtime startup is asynchronous from the main UI.
- Dev startup uses `npm run dev:fast` or watch mode to avoid rebuilding QWicks every run.
- MQPet indexes and common frames are cached as JSON manifests in production.

## Testing

Tests cover:

- Stage level mapping to Egg/Kid/Adult source stages.
- Gender-specific source paths.
- Adult mood fallback and Kid/Egg stage fallback.
- Required care/lifecycle actions exist in the source index.
- Existing FSM mappings still emit stable animation names during the fallback phase.


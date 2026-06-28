// MQPet behavior state machine. Mirrors the original QQPet action gates while
// keeping renderer-side animation decisions deterministic and testable.
import { statLimit, STAT_CONFIG, type MqPetStage, type MqPetState } from './mqpet-data';
import {
  boredAnimationForId,
  concernAnimationCount,
  concernAnimationFor,
  interactionAnimationForId,
  stageAssetForStage,
  type MqPetSourceActionKind,
} from './mqpet-source-assets';

export type MqPetConcern = 'health' | 'hunger' | 'cleanliness' | 'mood';
export type MqPetFsm =
  | { kind: 'Boot' }
  | { kind: 'Idle'; idleTime: number }
  | { kind: 'Bored'; animId: number; elapsed: number }
  | { kind: 'Interact'; animId: number; elapsed: number; remaining: number }
  | { kind: 'Question'; elapsed: number }
  | { kind: 'Dragging' }
  | { kind: 'Feed'; animId: 0 | 1; elapsed: number }
  | { kind: 'Clean'; elapsed: number }
  | { kind: 'LevelUp'; elapsed: number }
  | { kind: 'Concern'; concern: MqPetConcern; animId: number; elapsed: number }
  | { kind: 'Dying'; phase: 'Die' | 'Bury'; elapsed: number }
  | { kind: 'Dead' }
  | { kind: 'Revive'; elapsed: number };

export const IDLE_THRESHOLD_MS = 10000;
export const QUESTION_CD_MS = 1500;
export const FEED_CD_MS = 3500;
export const CLEAN_CD_MS = 3000;
export const LEVELUP_CD_MS = 2000;
export const BORED_CD_MS = 3000;
export const INTERACT_CD_MS = 2000;
export const REVIVE_CD_MS = 2500;
export const CONCERN_CD_MS = 2500;
export const STATUS_FEEDBACK_COOLDOWN_MS = 30000;

export const initialFsm: MqPetFsm = { kind: 'Boot' };

export interface ShuffleBag {
  remaining: number[];
  last: number | null;
}

const boredBag: ShuffleBag = { remaining: [], last: null };
const interactBag: ShuffleBag = { remaining: [], last: null };

function cdFor(kind: MqPetFsm['kind']): number {
  switch (kind) {
    case 'Question': return QUESTION_CD_MS;
    case 'Feed': return FEED_CD_MS;
    case 'Clean': return CLEAN_CD_MS;
    case 'LevelUp': return LEVELUP_CD_MS;
    case 'Revive': return REVIVE_CD_MS;
    case 'Concern': return CONCERN_CD_MS;
    case 'Bored': return BORED_CD_MS;
    case 'Interact': return INTERACT_CD_MS;
    default: return 3000;
  }
}

function elapsedState(s: MqPetFsm, dtMs: number): MqPetFsm {
  return 'elapsed' in s ? ({ ...s, elapsed: s.elapsed + dtMs } as MqPetFsm) : s;
}

function stepBackToIdle(s: MqPetFsm, dtMs: number): MqPetFsm {
  if (!('elapsed' in s)) return { kind: 'Idle', idleTime: 0 };
  const e = s.elapsed + dtMs;
  if (e >= cdFor(s.kind)) return { kind: 'Idle', idleTime: 0 };
  return { ...s, elapsed: e } as MqPetFsm;
}

export function pickFromShuffleBag(
  bag: ShuffleBag,
  count: number,
  random: () => number = Math.random,
  avoidLastOnRefill = false,
): { value: number; bag: ShuffleBag } {
  let remaining = bag.remaining.slice();
  if (remaining.length === 0) {
    remaining = Array.from({ length: count }, (_v, i) => i);
  }

  let index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
  if (avoidLastOnRefill && remaining.length > 1 && remaining[index] === bag.last) {
    index = (index + 1) % remaining.length;
  }

  const value = remaining[index];
  remaining.splice(index, 1);
  return { value, bag: { remaining, last: value } };
}

function mutateBag(target: ShuffleBag, next: ShuffleBag): void {
  target.remaining = next.remaining;
  target.last = next.last;
}

function randBored(): number {
  const next = pickFromShuffleBag(boredBag, 3, Math.random, true);
  mutateBag(boredBag, next.bag);
  return next.value;
}

function randInteract(): number {
  const next = pickFromShuffleBag(interactBag, 28, Math.random, false);
  mutateBag(interactBag, next.bag);
  return next.value;
}

function randomFeedId(random: () => number): 0 | 1 {
  return random() < 0.5 ? 0 : 1;
}

function isInterruptibleAction(s: MqPetFsm): boolean {
  return s.kind === 'Feed'
    || s.kind === 'Clean'
    || s.kind === 'Interact'
    || s.kind === 'Bored'
    || s.kind === 'LevelUp'
    || s.kind === 'Concern';
}

export function onTick(s: MqPetFsm, dtMs: number): MqPetFsm {
  switch (s.kind) {
    case 'Boot':
      return { kind: 'Idle', idleTime: 0 };
    case 'Idle':
      if (s.idleTime + dtMs >= IDLE_THRESHOLD_MS) return { kind: 'Bored', animId: randBored(), elapsed: 0 };
      return { kind: 'Idle', idleTime: s.idleTime + dtMs };
    case 'Bored':
    case 'Interact':
    case 'Feed':
    case 'Clean':
    case 'LevelUp':
    case 'Revive':
    case 'Concern':
    case 'Dying':
      return elapsedState(s, dtMs);
    case 'Question':
      return stepBackToIdle(s, dtMs);
    default:
      return s;
  }
}

export function onClick(s: MqPetFsm): MqPetFsm {
  if (s.kind === 'Dragging') return s;
  if (s.kind === 'Boot' || s.kind === 'Dead' || s.kind === 'Dying' || s.kind === 'Revive') return s;
  if (isInterruptibleAction(s)) return { kind: 'Question', elapsed: 0 };
  return { kind: 'Interact', animId: randInteract(), elapsed: 0, remaining: INTERACT_CD_MS };
}

export function onDragStart(s: MqPetFsm): MqPetFsm {
  if (s.kind === 'Boot' || s.kind === 'Dead' || s.kind === 'Dying') return s;
  return { kind: 'Dragging' };
}

export function onDragEnd(_s: MqPetFsm): MqPetFsm {
  return { kind: 'Idle', idleTime: 0 };
}

export function onFeed(_s: MqPetFsm, random: () => number = Math.random): MqPetFsm {
  return { kind: 'Feed', animId: randomFeedId(random), elapsed: 0 };
}

export function onClean(_s: MqPetFsm): MqPetFsm {
  return { kind: 'Clean', elapsed: 0 };
}

export function onLevelUp(_s: MqPetFsm): MqPetFsm {
  return { kind: 'LevelUp', elapsed: 0 };
}

export function onDeath(_s: MqPetFsm): MqPetFsm {
  return { kind: 'Dying', phase: 'Die', elapsed: 0 };
}

export function onRevive(_s: MqPetFsm): MqPetFsm {
  return { kind: 'Revive', elapsed: 0 };
}

export function onAnimComplete(s: MqPetFsm): MqPetFsm {
  if (s.kind === 'Idle' || s.kind === 'Dead') return s;
  if (s.kind === 'Dying' && s.phase === 'Die') return { kind: 'Dying', phase: 'Bury', elapsed: 0 };
  if (s.kind === 'Dying' && s.phase === 'Bury') return { kind: 'Dead' };
  return { kind: 'Idle', idleTime: 0 };
}

export function onMenu(s: MqPetFsm, action: 'feed' | 'clean' | 'work' | 'learn' | 'map' | 'status' | 'heal'): MqPetFsm {
  if (action === 'feed') return onFeed(s);
  if (action === 'clean') return onClean(s);
  return { kind: 'Idle', idleTime: 0 };
}

export function statusFeedbackForPetState(state: MqPetState): MqPetConcern | null {
  const hungerLimit = statLimit(state.level, STAT_CONFIG.hungerClean);
  const moodLimit = statLimit(state.level, STAT_CONFIG.mood);
  const healthLimit = statLimit(state.level, STAT_CONFIG.health);
  if (state.health <= Math.max(20, healthLimit * 0.3)) return 'health';
  if (state.hunger <= hungerLimit * 0.2) return 'hunger';
  if (state.cleanliness <= hungerLimit * 0.2) return 'cleanliness';
  if (state.mood <= moodLimit * 0.2) return 'mood';
  return null;
}

export function onStatusFeedback(
  s: MqPetFsm,
  state: MqPetState,
  random: () => number = Math.random,
): MqPetFsm {
  if (s.kind !== 'Idle') return s;
  const concern = statusFeedbackForPetState(state);
  if (!concern) return s;
  const count = concernAnimationCount(concern);
  const animId = Math.min(count - 1, Math.floor(random() * count));
  return { kind: 'Concern', concern, animId, elapsed: 0 };
}

export function animForFsm(s: MqPetFsm, stage: MqPetStage = 'Egg'): string {
  const stageAsset = stageAssetForStage(stage);
  switch (s.kind) {
    case 'Boot': return 'Enter';
    case 'Idle': return stageAsset.idle;
    case 'Bored': return boredAnimationForId(s.animId);
    case 'Interact': return interactionAnimationForId(s.animId);
    case 'Question': return 'Question';
    case 'Dragging': return stageAsset.stand;
    case 'Feed': return s.animId === 0 ? 'Eat1' : 'Eat2';
    case 'Clean': return 'Clean';
    case 'LevelUp': return 'LevelUP';
    case 'Concern':
      return concernAnimationFor(s.concern, s.animId);
    case 'Dying': return s.phase;
    case 'Dead': return 'Bury';
    case 'Revive': return 'Revive';
  }
}

export function sourceActionForFsm(s: MqPetFsm): MqPetSourceActionKind {
  switch (s.kind) {
    case 'Boot': return 'enter';
    case 'Idle': return 'stand';
    case 'Bored': return 'play';
    case 'Interact': return 'play';
    case 'Question': return 'speak';
    case 'Dragging': return 'stand';
    case 'Feed': return 'eat';
    case 'Clean': return 'clean';
    case 'LevelUp': return 'levelUp';
    case 'Concern': return 'interact';
    case 'Dying': return s.phase === 'Die' ? 'die' : 'bury';
    case 'Dead': return 'bury';
    case 'Revive': return 'revive';
  }
}

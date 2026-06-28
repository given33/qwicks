import { stageOf, statLimit, STAT_CONFIG, type MqPetStage } from './mqpet-data';
import type { MqpetConsolePanelRequest } from './mqpet-console-panel';
import {
  ORIGINAL_QQPET_ACTION_ASSETS,
  type OriginalQqpetActionFormat,
  type OriginalQqpetActionGender,
  type OriginalQqpetActionIndexEntry,
  type OriginalQqpetActionMood,
  type OriginalQqpetActionStage,
} from './mqpet-original-action-index';

export type MqPetSourceMenuAction = 'feed' | 'clean' | 'heal' | 'work' | 'learn' | 'map' | 'status';
export type MqPetSourceAnimName = string;
export type MqPetSourceGender = OriginalQqpetActionGender;
export type MqPetSourceStage = OriginalQqpetActionStage;
export type MqPetSourceMood = OriginalQqpetActionMood;
export type MqPetSourceActionKind = OriginalQqpetActionIndexEntry['action'];

export interface MqPetSourceAssetRef {
  gender: MqPetSourceGender;
  sourceStage: MqPetSourceStage;
  mood?: MqPetSourceMood;
  action: MqPetSourceActionKind;
  name: string;
  sourcePath: string;
  format: OriginalQqpetActionFormat;
}

export interface MqPetOriginalActionRequest {
  gender?: MqPetSourceGender;
  sourceStage: MqPetSourceStage;
  mood?: MqPetSourceMood;
  action: MqPetSourceActionKind;
  variant?: number;
}

export interface MqPetStageAsset {
  prefabGuid: string;
  animatorGuid: string;
  enterAnimatorGuid: string;
  idle: MqPetSourceAnimName;
  stand: MqPetSourceAnimName;
  walk: {
    down: MqPetSourceAnimName;
    up: MqPetSourceAnimName;
    left: MqPetSourceAnimName;
    right: MqPetSourceAnimName;
    leftDown: MqPetSourceAnimName;
    rightDown: MqPetSourceAnimName;
    leftUp: MqPetSourceAnimName;
    rightUp: MqPetSourceAnimName;
  };
}

const SOURCE_DESKTOP_STAGE_ASSET: MqPetStageAsset = {
  prefabGuid: 'bd3371d4ea96cae4990e9690a7707abd',
  animatorGuid: 'be8cc93b7cfd8ab4886a8e69c2e4cd9c',
  enterAnimatorGuid: 'b6891a6d681780041b53dbf8ca7e005c',
  idle: 'Pet_Idle',
  stand: 'Stand',
  walk: {
    down: 'Walk_Down',
    up: 'Walk_UP',
    left: 'Walk_Left',
    right: 'Walk_Right',
    leftDown: 'Walk_LeftDown',
    rightDown: 'Walk_RightDown',
    leftUp: 'Walk_LeftUP',
    rightUp: 'Walk_RightUP',
  },
};

// Source level0.unity binds Egg, Toddler, and Mature to this same QQ.prefab.
export const MQPET_STAGE_ASSETS: Record<MqPetStage, MqPetStageAsset> = {
  Egg: SOURCE_DESKTOP_STAGE_ASSET,
  Toddler: SOURCE_DESKTOP_STAGE_ASSET,
  Mature: SOURCE_DESKTOP_STAGE_ASSET,
};

export const MQPET_INTERACTION_ANIMS: MqPetSourceAnimName[] = Array.from(
  { length: 28 },
  (_value, index) => `Play${index + 1}`,
);

export const MQPET_BORED_ANIMS: MqPetSourceAnimName[] = ['Play', 'Play1', 'Play2'];

export const MQPET_CONCERN_ANIMS = {
  cleanliness: ['E1', 'E2', 'E3'],
  hunger: ['F1', 'F2', 'F3', 'F4', 'F5'],
  health: ['H1', 'H2', 'H3', 'H4'],
  mood: ['M1', 'M2'],
} as const satisfies Record<'health' | 'hunger' | 'cleanliness' | 'mood', readonly MqPetSourceAnimName[]>;

const DEFAULT_SOURCE_GENDER: MqPetSourceGender = 'GG';
const DEFAULT_SOURCE_MOOD: MqPetSourceMood = 'peaceful';

const ACTION_ASSETS = ORIGINAL_QQPET_ACTION_ASSETS as readonly MqPetSourceAssetRef[];

function sourceStageForStage(stage: MqPetStage): MqPetSourceStage {
  switch (stage) {
    case 'Egg':
      return 'Egg';
    case 'Toddler':
      return 'Kid';
    case 'Mature':
      return 'Adult';
  }
}

function normalizeVariant(variant: number | undefined, length: number): number {
  if (length <= 0) return 0;
  if (variant === undefined) return 0;
  return wrapIndex(variant, length);
}

function compareAssetNames(left: MqPetSourceAssetRef, right: MqPetSourceAssetRef): number {
  return left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' });
}

function candidatesFor(request: Required<Omit<MqPetOriginalActionRequest, 'mood' | 'variant'>> & {
  mood?: MqPetSourceMood;
}): MqPetSourceAssetRef[] {
  return ACTION_ASSETS
    .filter((asset) => {
      if (asset.gender !== request.gender) return false;
      if (asset.sourceStage !== request.sourceStage) return false;
      if (asset.action !== request.action) return false;
      if (request.mood !== undefined) return asset.mood === request.mood;
      return asset.mood === undefined;
    })
    .slice()
    .sort(compareAssetNames);
}

export function stageAssetForStage(stage: MqPetStage): MqPetStageAsset {
  return MQPET_STAGE_ASSETS[stage];
}

export function stageAssetForLevel(level: number): MqPetStageAsset {
  return stageAssetForStage(stageOf(level));
}

export function sourceStageForLevel(level: number): MqPetSourceStage {
  return sourceStageForStage(stageOf(level));
}

export function sourceMoodForPetState(state: {
  level: number;
  hunger: number;
  cleanliness: number;
  health: number;
  mood: number;
}): MqPetSourceMood {
  if (sourceStageForLevel(state.level) !== 'Adult') return DEFAULT_SOURCE_MOOD;

  const hungerLimit = statLimit(state.level, STAT_CONFIG.hungerClean);
  const moodLimit = statLimit(state.level, STAT_CONFIG.mood);
  const healthLimit = statLimit(state.level, STAT_CONFIG.health);

  if (state.health <= Math.max(20, healthLimit * 0.2)) return 'prostrate';
  if (state.mood <= moodLimit * 0.2) return 'sad';
  if (state.hunger <= hungerLimit * 0.2 || state.cleanliness <= hungerLimit * 0.2) return 'upset';
  if (state.mood >= moodLimit * 0.85 && state.health >= healthLimit * 0.75) return 'happy';
  return DEFAULT_SOURCE_MOOD;
}

export function resolveOriginalActionAsset(request: MqPetOriginalActionRequest): MqPetSourceAssetRef | null {
  const gender = request.gender ?? DEFAULT_SOURCE_GENDER;
  const stageRequest = {
    gender,
    sourceStage: request.sourceStage,
    action: request.action,
  };

  const candidateGroups = [
    request.mood ? candidatesFor({ ...stageRequest, mood: request.mood }) : [],
    request.mood && request.mood !== DEFAULT_SOURCE_MOOD
      ? candidatesFor({ ...stageRequest, mood: DEFAULT_SOURCE_MOOD })
      : [],
    candidatesFor(stageRequest),
  ];

  for (const group of candidateGroups) {
    if (group.length === 0) continue;
    return group[normalizeVariant(request.variant, group.length)] ?? null;
  }

  return null;
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((Math.trunc(index) % length) + length) % length;
}

export function interactionAnimationForId(id: number): MqPetSourceAnimName {
  return MQPET_INTERACTION_ANIMS[wrapIndex(id, MQPET_INTERACTION_ANIMS.length)];
}

export function boredAnimationForId(id: number): MqPetSourceAnimName {
  return MQPET_BORED_ANIMS[wrapIndex(id, MQPET_BORED_ANIMS.length)];
}

export function concernAnimationCount(concern: keyof typeof MQPET_CONCERN_ANIMS): number {
  return MQPET_CONCERN_ANIMS[concern].length;
}

export function concernAnimationFor(concern: keyof typeof MQPET_CONCERN_ANIMS, id: number): MqPetSourceAnimName {
  const anims = MQPET_CONCERN_ANIMS[concern];
  return anims[wrapIndex(id, anims.length)];
}

export function consolePanelForMenuAction(action: MqPetSourceMenuAction): MqpetConsolePanelRequest | null {
  switch (action) {
    case 'feed':
      return { tab: 'inventory', main: 'Feeding', sub: 'Food' };
    case 'clean':
      return { tab: 'inventory', main: 'Feeding', sub: 'Daily' };
    case 'heal':
      return { tab: 'inventory', main: 'Feeding', sub: 'Medicine' };
    case 'map':
      return { tab: 'map' };
    case 'status':
      return { tab: 'status' };
    case 'work':
      return { tab: 'activity', mode: 'work' };
    case 'learn':
      return { tab: 'activity', mode: 'learn' };
  }
}

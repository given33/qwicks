import { stageOf, type MqPetStage } from './mqpet-data';
import type { MqpetConsolePanelRequest } from './mqpet-console-panel';

export type MqPetSourceMenuAction = 'feed' | 'clean' | 'heal' | 'work' | 'learn' | 'map' | 'status';
export type MqPetSourceAnimName = string;

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

export function stageAssetForStage(stage: MqPetStage): MqPetStageAsset {
  return MQPET_STAGE_ASSETS[stage];
}

export function stageAssetForLevel(level: number): MqPetStageAsset {
  return stageAssetForStage(stageOf(level));
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

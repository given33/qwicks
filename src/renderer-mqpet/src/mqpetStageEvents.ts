import {
  sourceActionForFsm,
  statusFeedbackForPetState,
  STATUS_FEEDBACK_COOLDOWN_MS,
  type MqPetFsm,
} from '@shared/mqpet-fsm';
import type { MqPetSave } from '@shared/mqpet-state';
import { stageOf, type MqPetState } from '@shared/mqpet-data';
import {
  resolveOriginalActionAsset,
  sourceMoodForPetState,
  sourceStageForLevel,
  type MqPetSourceAssetRef,
} from '@shared/mqpet-source-assets';

export type StageAnimationEvent = 'feed' | 'clean' | 'level-up' | 'death' | 'revive' | 'stage-change';

export interface StageSnapshot {
  state: MqPetState;
}

export function animationEventForSaveChange(
  previous: StageSnapshot | null,
  next: StageSnapshot,
): StageAnimationEvent | null {
  if (!previous) return null;
  const prevState = previous.state;
  const nextState = next.state;

  if (prevState.health > 0 && nextState.health <= 0) return 'death';
  if (prevState.health <= 0 && nextState.health > 0) return 'revive';
  if (nextState.level > prevState.level) return 'level-up';
  if (stageOf(nextState.level) !== stageOf(prevState.level)) return 'stage-change';
  return null;
}

export function animationEventForItemEffect(
  previous: StageSnapshot,
  next: StageSnapshot,
): StageAnimationEvent | null {
  const prevState = previous.state;
  const nextState = next.state;
  if (prevState.health <= 0 && nextState.health > 0) return 'revive';
  if (nextState.hunger > prevState.hunger) return 'feed';
  if (nextState.cleanliness > prevState.cleanliness) return 'clean';
  if (prevState.health > 0 && nextState.health <= 0) return 'death';
  return null;
}

export function animationEventForStateUpdate(
  previous: StageSnapshot | null,
  next: StageSnapshot,
): StageAnimationEvent | null {
  if (!previous) return null;
  return animationEventForItemEffect(previous, next) ?? animationEventForSaveChange(previous, next);
}

export function shouldApplyStatusFeedback(
  save: MqPetSave,
  now: number,
  lastFeedbackAt: number,
): boolean {
  if (!statusFeedbackForPetState(save.state)) return false;
  if (lastFeedbackAt <= 0) return true;
  return now - lastFeedbackAt >= STATUS_FEEDBACK_COOLDOWN_MS;
}

export function sourceAssetForStageFrame(save: MqPetSave | null, fsm: MqPetFsm): MqPetSourceAssetRef | null {
  if (!save) return null;
  const action = sourceActionForFsm(fsm);
  const variant = 'animId' in fsm ? fsm.animId : undefined;
  return resolveOriginalActionAsset({
    gender: 'GG',
    sourceStage: sourceStageForLevel(save.state.level),
    mood: sourceMoodForPetState(save.state),
    action,
    variant,
  });
}

import { describe, expect, it } from 'vitest';
import {
  animationEventForItemEffect,
  animationEventForSaveChange,
  shouldApplyStatusFeedback,
  type StageSnapshot,
} from './mqpetStageEvents';
import { defaultSave } from '@shared/mqpet-state';
import { defaultState } from '@shared/mqpet-data';

function snap(level: number, overrides: Partial<ReturnType<typeof defaultState>> = {}): StageSnapshot {
  return { state: { ...defaultState(), level, ...overrides } };
}

describe('MQPet stage animation events', () => {
  it('plays LevelUP when level increases', () => {
    expect(animationEventForSaveChange(snap(9), snap(10))).toBe('level-up');
  });

  it('plays death and revive when health crosses zero', () => {
    expect(animationEventForSaveChange(snap(10, { health: 1 }), snap(10, { health: 0 }))).toBe('death');
    expect(animationEventForSaveChange(snap(10, { health: 0 }), snap(10, { health: 80 }))).toBe('revive');
  });

  it('returns stage-change when level enters a new evolution stage without a level-up event', () => {
    expect(animationEventForSaveChange(snap(10), snap(30))).toBe('level-up');
  });
});

describe('MQPet item effect animation events', () => {
  it('feeds for hunger items, cleans for clean items, revives for medicine from zero health', () => {
    expect(animationEventForItemEffect(snap(1), snap(1, { hunger: 1200 }))).toBe('feed');
    expect(animationEventForItemEffect(snap(1), snap(1, { cleanliness: 1200 }))).toBe('clean');
    expect(animationEventForItemEffect(snap(1, { health: 0 }), snap(1, { health: 80 }))).toBe('revive');
  });
});

describe('MQPet status feedback gate', () => {
  it('does not spam low-stat reminders more often than the cooldown', () => {
    const save = { ...defaultSave(0), state: { ...defaultState(), hunger: 100 } };
    expect(shouldApplyStatusFeedback(save, 10_000, 0)).toBe(true);
    expect(shouldApplyStatusFeedback(save, 11_000, 10_000)).toBe(false);
    expect(shouldApplyStatusFeedback(save, 40_001, 10_000)).toBe(true);
  });
});

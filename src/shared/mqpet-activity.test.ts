import { describe, expect, it } from 'vitest';
import { defaultState } from './mqpet-data';
import {
  activityProgress,
  canStartActivity,
  learnRewardForLevel,
  workNetGoldPerTick,
  workWageAndCostForLevel,
} from './mqpet-activity';

describe('MQPet source activity rules', () => {
  it('uses the source work wage and cost brackets', () => {
    expect(workWageAndCostForLevel(1)).toEqual({ wage: 20, cost: 18 });
    expect(workWageAndCostForLevel(15)).toEqual({ wage: 30, cost: 26 });
    expect(workWageAndCostForLevel(30)).toEqual({ wage: 36, cost: 26 });
    expect(workNetGoldPerTick(1)).toBe(2);
  });

  it('uses the source learning reward brackets', () => {
    expect(learnRewardForLevel(1)).toBe(20);
    expect(learnRewardForLevel(10)).toBe(50);
    expect(learnRewardForLevel(20)).toBe(100);
  });

  it('explains why work or learning cannot start', () => {
    expect(canStartActivity({ ...defaultState(), health: 10 }, 'work')).toEqual({
      ok: false,
      reason: '生病时不能打工',
    });
    expect(canStartActivity({ ...defaultState(), stamina: 10 }, 'work')).toEqual({
      ok: false,
      reason: '体力不足，休息到 20 以上再打工',
    });
    expect(canStartActivity({ ...defaultState(), activity: 'Working' }, 'learn')).toEqual({
      ok: false,
      reason: '当前正在打工中',
    });
  });

  it('reports progress from source workTimer/workTarget fields', () => {
    expect(activityProgress({ ...defaultState(), activity: 'Working', workTimer: 1, workTarget: 4 })).toEqual({
      current: 1,
      target: 4,
      percent: 25,
    });
  });
});

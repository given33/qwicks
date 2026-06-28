// src/shared/mqpet-data.test.ts
import { describe, expect, it } from 'vitest';
import {
  defaultState, stageOf, statLimit, STAT_CONFIG, isSick, tick, applyItem,
  startWorking, startLearning, settleWork, settleLearn, interact,
  MAX_INTERACTIONS_PER_DAY, effectiveCharm,
} from './mqpet-data';

describe('stageOf', () => {
  it('maps levels to Egg/Toddler/Mature', () => {
    expect(stageOf(1)).toBe('Egg');
    expect(stageOf(9)).toBe('Egg');
    expect(stageOf(10)).toBe('Toddler');
    expect(stageOf(29)).toBe('Toddler');
    expect(stageOf(30)).toBe('Mature');
  });
});

describe('statLimit', () => {
  it('caps at the stage ceiling', () => {
    const cfg = STAT_CONFIG.hungerClean;
    // level 1: base + (1-1)*growth = 3000, capped at Egg 4000 -> 3000
    expect(statLimit(1, cfg)).toBe(3000);
    // level 2: 3000 + 1*100 = 3100
    expect(statLimit(2, cfg)).toBe(3100);
    // level 100: 3000 + 99*100 = 12900, capped at Mature 9000
    expect(statLimit(100, cfg)).toBe(9000);
  });
  it('respects toddler cap for mid levels', () => {
    expect(statLimit(20, STAT_CONFIG.hungerClean)).toBeLessThanOrEqual(6000);
  });
});

describe('tick', () => {
  it('decreases hunger/cleanliness/mood by one tick', () => {
    const s = defaultState();
    const before = { hunger: s.hunger, cleanliness: s.cleanliness, mood: s.mood };
    const next = tick(s);
    expect(next.hunger).toBeLessThan(before.hunger);
    expect(next.cleanliness).toBeLessThan(before.cleanliness);
    expect(next.mood).toBeLessThan(before.mood);
  });

  it('Idle with high mood gains +2 growth', () => {
    const s = defaultState(); // mood 1000 >= 900
    const next = tick(s);
    expect(next.growth).toBe(2);
  });

  it('Idle with low mood gains +1 growth', () => {
    const s = { ...defaultState(), mood: 100 };
    const next = tick(s);
    expect(next.growth).toBe(1);
  });

  it('clamps hunger at 0 and drops health when starving', () => {
    const s = { ...defaultState(), hunger: 0, cleanliness: 0 };
    const before = s.health;
    const next = tick(s);
    expect(next.hunger).toBe(0);
    expect(next.health).toBeLessThan(before);
  });

  it('Working drains stamina and accumulates workTimer', () => {
    const s = { ...defaultState(), activity: 'Working' as const, workTarget: 4, workTimer: 0, stamina: 100 };
    const next = tick(s);
    expect(next.workTimer).toBe(1);
    expect(next.stamina).toBeLessThan(s.stamina);
  });

  it('Working settles and returns to Idle when workTimer reaches target', () => {
    const s = { ...defaultState(), activity: 'Working' as const, workTarget: 1, workTimer: 0, stamina: 100 };
    const next = tick(s);
    expect(next.activity).toBe('Idle');
    expect(next.gold).toBeGreaterThan(s.gold);
  });
});

describe('isSick', () => {
  it('is sick when health low or starving or filthy', () => {
    expect(isSick({ ...defaultState(), health: 50 })).toBe(true);
    expect(isSick({ ...defaultState(), hunger: 0 })).toBe(true);
    expect(isSick({ ...defaultState(), cleanliness: 0 })).toBe(true);
    expect(isSick(defaultState())).toBe(false);
  });
});

describe('startWorking / startLearning', () => {
  it('refuses when sick', () => {
    const s = { ...defaultState(), health: 10 };
    expect(startWorking({ ...s })).toBe(false);
    expect(startLearning({ ...s })).toBe(false);
  });
  it('refuses when not Idle', () => {
    const s = { ...defaultState(), activity: 'Learning' as const };
    expect(startWorking({ ...s })).toBe(false);
  });
  it('refuses work when stamina too low', () => {
    const s = { ...defaultState(), stamina: 10 };
    expect(startWorking({ ...s })).toBe(false);
  });
  it('starts work, mutating activity and target', () => {
    const s = defaultState();
    expect(startWorking(s)).toBe(true);
    expect(s.activity).toBe('Working');
    expect(s.workTarget).toBe(4);
  });
});

describe('interact', () => {
  it('adds 200 mood until daily cap reached', () => {
    let s = defaultState();
    for (let i = 0; i < MAX_INTERACTIONS_PER_DAY; i++) {
      s = interact(s);
      expect(s.interactionCount).toBe(i + 1);
    }
    const before = s.mood;
    s = interact(s); // over cap
    expect(s.interactionCount).toBe(MAX_INTERACTIONS_PER_DAY);
    expect(s.mood).toBe(before);
  });
});

describe('applyItem', () => {
  it('applies hunger effect and clamps', () => {
    const s = defaultState();
    const next = applyItem(s, { addHunger: 500, addCleanliness: 0, addHealth: 0, addMood: 0, addCharm: 0, addGrowth: 0, buffDuration: 0 });
    expect(next.hunger).toBe(s.hunger + 500);
  });
  it('adds timed charm buff', () => {
    const s = defaultState();
    const next = applyItem(s, { addHunger: 0, addCleanliness: 0, addHealth: 0, addMood: 0, addCharm: 30, addGrowth: 0, buffDuration: 3600 });
    expect(next.charmBuffs).toHaveLength(1);
    expect(effectiveCharm(next)).toBe(30);
  });
  it('applies original Config stat triples to stress, intelligence, and charm within source caps', () => {
    const s = { ...defaultState(), level: 30 };
    const next = applyItem(s, {
      addHunger: 0,
      addCleanliness: 0,
      addHealth: 0,
      addMood: 0,
      addStressResistance: 4,
      addIntelligence: 5,
      addCharm: 6,
      addGrowth: 0,
      buffDuration: 0,
    });
    expect(next.stressResistance).toBe(s.stressResistance + 4);
    expect(next.intelligence).toBe(s.intelligence + 5);
    expect(next.charm).toBe(s.charm + 6);
  });
});

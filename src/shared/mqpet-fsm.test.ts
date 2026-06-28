import { describe, expect, it } from 'vitest';
import {
  animForFsm,
  initialFsm,
  onAnimComplete,
  onClean,
  onClick,
  onDeath,
  onDragEnd,
  onDragStart,
  onFeed,
  onMenu,
  onRevive,
  onStatusFeedback,
  onTick,
  pickFromShuffleBag,
  statusFeedbackForPetState,
  type ShuffleBag,
} from './mqpet-fsm';
import { defaultState, type MqPetStage } from './mqpet-data';

describe('onTick idle to bored', () => {
  it('transitions Idle to Bored when idleTime crosses 10s', () => {
    const next = onTick({ kind: 'Idle', idleTime: 10000 }, 16);
    expect(next.kind).toBe('Bored');
  });

  it('stays Idle below threshold', () => {
    const next = onTick({ kind: 'Idle', idleTime: 5000 }, 16);
    expect(next.kind).toBe('Idle');
  });

  it('Boot ticks to Idle', () => {
    const next = onTick({ kind: 'Boot' }, 16);
    expect(next.kind).toBe('Idle');
  });
});

describe('onClick', () => {
  it('Idle click goes to Interact', () => {
    const next = onClick({ kind: 'Idle', idleTime: 0 });
    expect(next.kind).toBe('Interact');
  });

  it('action-in-progress click goes to Question', () => {
    const next = onClick({ kind: 'Bored', animId: 0, elapsed: 0 });
    expect(next.kind).toBe('Question');
  });

  it('Dragging click is a no-op', () => {
    const next = onClick({ kind: 'Dragging' });
    expect(next.kind).toBe('Dragging');
  });
});

describe('drag', () => {
  it('drag start from Idle to Dragging', () => {
    const next = onDragStart({ kind: 'Idle', idleTime: 0 });
    expect(next.kind).toBe('Dragging');
  });

  it('drag end to Idle', () => {
    const next = onDragEnd({ kind: 'Dragging' });
    expect(next.kind).toBe('Idle');
  });
});

describe('feed, clean, menu', () => {
  it('onFeed enters Feed', () => {
    const next = onFeed({ kind: 'Idle', idleTime: 0 }, () => 0.25);
    expect(next.kind).toBe('Feed');
  });

  it('onFeed randomly chooses Eat1 or Eat2', () => {
    expect(animForFsm(onFeed({ kind: 'Idle', idleTime: 0 }, () => 0.25))).toBe('Eat1');
    expect(animForFsm(onFeed({ kind: 'Idle', idleTime: 0 }, () => 0.75))).toBe('Eat2');
  });

  it('onClean enters Clean', () => {
    const next = onClean({ kind: 'Idle', idleTime: 0 });
    expect(next.kind).toBe('Clean');
  });

  it('onMenu feed enters Feed', () => {
    const next = onMenu({ kind: 'Idle', idleTime: 0 }, 'feed');
    expect(next.kind).toBe('Feed');
  });

  it('onMenu clean enters Clean', () => {
    const next = onMenu({ kind: 'Idle', idleTime: 0 }, 'clean');
    expect(next.kind).toBe('Clean');
  });

  it('onMenu work/learn/map/status returns Idle because console handles it', () => {
    expect(onMenu({ kind: 'Bored', animId: 0, elapsed: 0 }, 'work').kind).toBe('Idle');
    expect(onMenu({ kind: 'Bored', animId: 0, elapsed: 0 }, 'learn').kind).toBe('Idle');
  });
});

describe('animForFsm', () => {
  it('maps each FSM kind to an animation name', () => {
    expect(animForFsm({ kind: 'Boot' })).toBe('Enter');
    expect(animForFsm({ kind: 'Idle', idleTime: 0 })).toBe('Pet_Idle');
    expect(animForFsm({ kind: 'Feed', animId: 0, elapsed: 0 })).toBe('Eat1');
    expect(animForFsm({ kind: 'Feed', animId: 1, elapsed: 0 })).toBe('Eat2');
    expect(animForFsm({ kind: 'Clean', elapsed: 0 })).toBe('Clean');
    expect(animForFsm({ kind: 'LevelUp', elapsed: 0 })).toBe('LevelUP');
    expect(animForFsm({ kind: 'Dying', phase: 'Die', elapsed: 0 })).toBe('Die');
    expect(animForFsm({ kind: 'Dying', phase: 'Bury', elapsed: 0 })).toBe('Bury');
    expect(animForFsm({ kind: 'Dead' })).toBe('Bury');
    expect(animForFsm({ kind: 'Revive', elapsed: 0 })).toBe('Revive');
  });

  it('Bored uses source bored actions while Interact maps to the normalized 28 Play actions', () => {
    expect(animForFsm({ kind: 'Bored', animId: 0, elapsed: 0 })).toBe('Play');
    expect(animForFsm({ kind: 'Interact', animId: 5, elapsed: 0, remaining: 0 })).toBe('Play6');
  });

  it('accepts a stage while using the extracted shared prefab resource table', () => {
    const stages: MqPetStage[] = ['Egg', 'Toddler', 'Mature'];
    expect(stages.map((stage) => animForFsm({ kind: 'Idle', idleTime: 0 }, stage))).toEqual([
      'Pet_Idle',
      'Pet_Idle',
      'Pet_Idle',
    ]);
  });
});

describe('shuffle bag helpers', () => {
  it('plays all 28 interaction ids once before repeating', () => {
    let bag: ShuffleBag = { remaining: [], last: null };
    const seen: number[] = [];
    for (let i = 0; i < 28; i += 1) {
      const next = pickFromShuffleBag(bag, 28, () => 0, false);
      seen.push(next.value);
      bag = next.bag;
    }
    expect(new Set(seen).size).toBe(28);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 28 }, (_v, i) => i));
  });

  it('does not repeat bored ids across bag refills when possible', () => {
    let bag: ShuffleBag = { remaining: [0], last: 1 };
    let next = pickFromShuffleBag(bag, 3, () => 0, true);
    expect(next.value).toBe(0);
    bag = next.bag;

    next = pickFromShuffleBag(bag, 3, () => 0, true);
    expect(next.value).not.toBe(0);
  });
});

describe('death and revive sequence', () => {
  it('plays Die, then Bury, then stays Dead', () => {
    const dying = onDeath({ kind: 'Idle', idleTime: 0 });
    expect(dying).toEqual({ kind: 'Dying', phase: 'Die', elapsed: 0 });
    const burying = onAnimComplete(dying);
    expect(burying).toEqual({ kind: 'Dying', phase: 'Bury', elapsed: 0 });
    expect(onAnimComplete(burying)).toEqual({ kind: 'Dead' });
  });

  it('revive plays Revive and returns to Idle after completion', () => {
    const revive = onRevive({ kind: 'Dead' });
    expect(animForFsm(revive)).toBe('Revive');
    expect(onAnimComplete(revive)).toEqual({ kind: 'Idle', idleTime: 0 });
  });
});

describe('status feedback', () => {
  it('prioritizes health, then hunger, cleanliness, mood reminders', () => {
    expect(statusFeedbackForPetState({ ...defaultState(), health: 10 })).toBe('health');
    expect(statusFeedbackForPetState({ ...defaultState(), hunger: 100 })).toBe('hunger');
    expect(statusFeedbackForPetState({ ...defaultState(), cleanliness: 100 })).toBe('cleanliness');
    expect(statusFeedbackForPetState({ ...defaultState(), mood: 100 })).toBe('mood');
  });

  it('turns low-status idle into a concern animation', () => {
    const next = onStatusFeedback({ kind: 'Idle', idleTime: 0 }, { ...defaultState(), hunger: 100 }, () => 0.99);
    expect(next).toEqual({ kind: 'Concern', concern: 'hunger', animId: 4, elapsed: 0 });
    expect(animForFsm(next)).toBe('F5');
  });
});

describe('initialFsm', () => {
  it('starts at Boot', () => {
    expect(initialFsm.kind).toBe('Boot');
  });
});

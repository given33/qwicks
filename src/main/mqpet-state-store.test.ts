import { describe, expect, it } from 'vitest';
import { defaultSave } from '../shared/mqpet-state';
import { MqpetStateStore, mutateSyncUnityState } from './mqpet-state-store';

describe('MQPet state store Unity sync', () => {
  it('merges Unity pet state snapshots into the QWicks save without replacing inventory metadata', () => {
    const store = new MqpetStateStore();
    const before = defaultSave(1_700_000_000_000);
    store.update(() => ({
      ...before,
      inventory: [{ itemId: 'food:melon-jelly', count: 2 }],
      interactedDate: '2023-11-14',
    }));

    const changed = mutateSyncUnityState(store, JSON.stringify({
      state: {
        level: 12,
        growth: 34,
        gold: 456,
        hunger: 789,
        cleanliness: 654,
        health: 123,
        mood: 987,
        stamina: 222,
        intelligence: 333,
        stressResistance: 44,
        charm: 55,
        activity: 'Working',
        workTimer: 2,
        workTarget: 4,
        interactionCount: 3,
      },
    }), 1_700_000_010_000);

    const save = store.getSnapshot();
    expect(changed).toBe(true);
    expect(save.inventory).toEqual([{ itemId: 'food:melon-jelly', count: 2 }]);
    expect(save.interactedDate).toBe('2023-11-14');
    expect(save.lastSaved).toBe(1_700_000_010_000);
    expect(save.state).toMatchObject({
      level: 12,
      growth: 34,
      gold: 456,
      hunger: 789,
      cleanliness: 654,
      health: 123,
      mood: 987,
      stamina: 222,
      intelligence: 333,
      stressResistance: 44,
      charm: 55,
      activity: 'Working',
      workTimer: 2,
      workTarget: 4,
      interactionCount: 3,
    });
  });

  it('rejects malformed Unity state snapshots', () => {
    const store = new MqpetStateStore();
    const before = store.getSnapshot();

    expect(mutateSyncUnityState(store, '{bad json', 1_700_000_010_000)).toBe(false);
    expect(store.getSnapshot()).toEqual(before);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MQPET_BORED_ANIMS,
  MQPET_CONCERN_ANIMS,
  MQPET_INTERACTION_ANIMS,
  MQPET_STAGE_ASSETS,
  boredAnimationForId,
  concernAnimationFor,
  consolePanelForMenuAction,
  interactionAnimationForId,
  stageAssetForLevel,
} from './mqpet-source-assets';

describe('MQPet source asset map', () => {
  it('binds all evolution stages to the same source desktop pet prefab', () => {
    expect(MQPET_STAGE_ASSETS.Egg.prefabGuid).toBe('bd3371d4ea96cae4990e9690a7707abd');
    expect(MQPET_STAGE_ASSETS.Toddler).toEqual(MQPET_STAGE_ASSETS.Egg);
    expect(MQPET_STAGE_ASSETS.Mature).toEqual(MQPET_STAGE_ASSETS.Egg);
    expect(stageAssetForLevel(1)).toBe(MQPET_STAGE_ASSETS.Egg);
    expect(stageAssetForLevel(10)).toBe(MQPET_STAGE_ASSETS.Toddler);
    expect(stageAssetForLevel(30)).toBe(MQPET_STAGE_ASSETS.Mature);
  });

  it('normalizes QWicks click interactions to the 28 Play actions', () => {
    expect(MQPET_INTERACTION_ANIMS).toHaveLength(28);
    expect(interactionAnimationForId(0)).toBe('Play1');
    expect(interactionAnimationForId(27)).toBe('Play28');
    expect(interactionAnimationForId(28)).toBe('Play1');
  });

  it('uses the source first three Play transitions for bored reminders', () => {
    expect(MQPET_BORED_ANIMS).toEqual(['Play', 'Play1', 'Play2']);
    expect(boredAnimationForId(0)).toBe('Play');
    expect(boredAnimationForId(2)).toBe('Play2');
  });

  it('maps low status concerns to the extracted E/F/H/M animations', () => {
    expect(MQPET_CONCERN_ANIMS.cleanliness).toEqual(['E1', 'E2', 'E3']);
    expect(MQPET_CONCERN_ANIMS.hunger).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(MQPET_CONCERN_ANIMS.health).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect(MQPET_CONCERN_ANIMS.mood).toEqual(['M1', 'M2']);
    expect(concernAnimationFor('hunger', 4)).toBe('F5');
  });

  it('opens original radial menu actions to their QWicks console panels', () => {
    expect(consolePanelForMenuAction('feed')).toEqual({ tab: 'inventory', main: 'Feeding', sub: 'Food' });
    expect(consolePanelForMenuAction('clean')).toEqual({ tab: 'inventory', main: 'Feeding', sub: 'Daily' });
    expect(consolePanelForMenuAction('heal')).toEqual({ tab: 'inventory', main: 'Feeding', sub: 'Medicine' });
    expect(consolePanelForMenuAction('work')).toEqual({ tab: 'activity', mode: 'work' });
    expect(consolePanelForMenuAction('learn')).toEqual({ tab: 'activity', mode: 'learn' });
    expect(consolePanelForMenuAction('map')).toEqual({ tab: 'map' });
    expect(consolePanelForMenuAction('status')).toEqual({ tab: 'status' });
  });
});

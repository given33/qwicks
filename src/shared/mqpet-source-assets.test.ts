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
  resolveOriginalActionAsset,
  sourceMoodForPetState,
  sourceStageForLevel,
  stageAssetForLevel,
} from './mqpet-source-assets';
import { defaultState } from './mqpet-data';

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

  it('maps QWicks level stages to original pet source stages', () => {
    expect(sourceStageForLevel(1)).toBe('Egg');
    expect(sourceStageForLevel(9)).toBe('Egg');
    expect(sourceStageForLevel(10)).toBe('Kid');
    expect(sourceStageForLevel(29)).toBe('Kid');
    expect(sourceStageForLevel(30)).toBe('Adult');
  });

  it('resolves original stage and gender action resources from pet/Action', () => {
    expect(resolveOriginalActionAsset({ gender: 'GG', sourceStage: 'Egg', action: 'stand' })).toMatchObject({
      format: 'swf',
      sourcePath: 'Action/GG/Egg/Stand.swf',
    });
    expect(resolveOriginalActionAsset({ gender: 'MM', sourceStage: 'Kid', action: 'clean' })).toMatchObject({
      format: 'swf',
      sourcePath: 'Action/MM/Kid/Clean.swf',
    });
    expect(resolveOriginalActionAsset({ gender: 'GG', sourceStage: 'Adult', action: 'eat', variant: 1 })).toMatchObject({
      sourcePath: 'Action/GG/Adult/Eat2.swf',
    });
  });

  it('uses adult mood folders for original adult stand and play resources', () => {
    expect(resolveOriginalActionAsset({
      gender: 'MM',
      sourceStage: 'Adult',
      mood: 'peaceful',
      action: 'stand',
    })).toMatchObject({
      sourcePath: 'Action/MM/Adult/peaceful/Stand.swf',
    });
    expect(resolveOriginalActionAsset({
      gender: 'GG',
      sourceStage: 'Adult',
      mood: 'happy',
      action: 'play',
      variant: 0,
    })).toMatchObject({
      sourcePath: 'Action/GG/Adult/happy/play/P1.swf',
    });
  });

  it('falls back to stage-level folders when a mood-specific original action is not available', () => {
    expect(resolveOriginalActionAsset({
      gender: 'GG',
      sourceStage: 'Kid',
      mood: 'happy',
      action: 'play',
      variant: 27,
    })).toMatchObject({
      sourcePath: 'Action/GG/Kid/play/P28.swf',
    });
    expect(resolveOriginalActionAsset({
      gender: 'MM',
      sourceStage: 'Egg',
      mood: 'sad',
      action: 'interact',
      variant: 0,
    })).toMatchObject({
      sourcePath: 'Action/MM/Egg/interact/E1.swf',
    });
  });

  it('derives original adult mood from pet stats', () => {
    expect(sourceMoodForPetState({
      ...defaultState(),
      level: 30,
      hunger: 8000,
      cleanliness: 8000,
      mood: 3900,
      health: 180,
    })).toBe('happy');
    expect(sourceMoodForPetState({ ...defaultState(), level: 30, hunger: 100 })).toBe('upset');
    expect(sourceMoodForPetState({ ...defaultState(), level: 30, health: 20 })).toBe('prostrate');
    expect(sourceMoodForPetState({ ...defaultState(), level: 30, mood: 100 })).toBe('sad');
    expect(sourceMoodForPetState({ ...defaultState(), level: 1 })).toBe('peaceful');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeConsolePanelRequest } from './mqpet-console-panel';

describe('normalizeConsolePanelRequest', () => {
  it('opens the Medicine inventory category for medical menu', () => {
    expect(normalizeConsolePanelRequest({ tab: 'inventory', main: 'Feeding', sub: 'Medicine' })).toEqual({
      tab: 'inventory',
      main: 'Feeding',
      sub: 'Medicine',
    });
  });

  it('falls back to status for invalid input', () => {
    expect(normalizeConsolePanelRequest({ tab: 'inventory', main: 'DressUp', sub: 'Medicine' })).toEqual({
      tab: 'status',
    });
    expect(normalizeConsolePanelRequest({ tab: 'wat' })).toEqual({ tab: 'status' });
  });

  it('opens source gameplay panels for work, learn, and map menu actions', () => {
    expect(normalizeConsolePanelRequest({ tab: 'activity', mode: 'work' })).toEqual({
      tab: 'activity',
      mode: 'work',
    });
    expect(normalizeConsolePanelRequest({ tab: 'activity', mode: 'learn' })).toEqual({
      tab: 'activity',
      mode: 'learn',
    });
    expect(normalizeConsolePanelRequest({ tab: 'map' })).toEqual({ tab: 'map' });
  });

  it('rejects invalid activity modes', () => {
    expect(normalizeConsolePanelRequest({ tab: 'activity', mode: 'play' })).toEqual({ tab: 'status' });
  });
});

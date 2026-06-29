import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const invoke = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api;
    },
  },
  ipcRenderer: {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}));

describe('mqpet preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    for (const key of Object.keys(exposed)) delete exposed[key];
  });

  it('exposes Unity state sync over IPC', async () => {
    await import('./mqpet');

    const api = exposed.mqpet as { syncUnityState: (payload: string) => Promise<unknown> };
    await api.syncUnityState('{"state":{"gold":250}}');

    expect(invoke).toHaveBeenCalledWith('mqpet:sync-unity-state', '{"state":{"gold":250}}');
  });
});

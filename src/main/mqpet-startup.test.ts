import { describe, expect, it, vi } from 'vitest';
import { scheduleMqpetStartup } from './mqpet-startup';

describe('scheduleMqpetStartup', () => {
  it('waits for the main window to finish loading and then applies an idle delay', () => {
    vi.useFakeTimers();
    try {
      const create = vi.fn();
      const listeners = new Map<string, () => void>();
      const webContents = {
        isLoadingMainFrame: () => true,
        once: (event: string, cb: () => void) => {
          listeners.set(event, cb);
        },
      };

      scheduleMqpetStartup({
        enabled: true,
        mainWindow: { webContents },
        create,
        setTimeout: (cb, ms) => {
          return setTimeout(cb, ms);
        },
        requestIdleCallback: undefined,
        delayMs: 1500,
      });

      expect(create).not.toHaveBeenCalled();
      listeners.get('did-finish-load')?.();
      vi.advanceTimersByTime(1499);
      expect(create).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when disabled', () => {
    const create = vi.fn();
    scheduleMqpetStartup({
      enabled: false,
      mainWindow: null,
      create,
      setTimeout: (cb) => {
        cb();
        return 0;
      },
      requestIdleCallback: undefined,
      delayMs: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });
});

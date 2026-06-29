import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMqpetHeartbeat } from './mqpetHeartbeat';

describe('MQPet renderer heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an immediate heartbeat and repeats every two seconds until stopped', () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn();

    const stop = startMqpetHeartbeat(heartbeat);

    expect(heartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1999);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(4000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it('allows a missing bridge heartbeat without throwing', () => {
    vi.useFakeTimers();

    const stop = startMqpetHeartbeat(undefined);
    vi.advanceTimersByTime(6000);

    expect(() => stop()).not.toThrow();
  });
});

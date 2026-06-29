const MQPET_HEARTBEAT_INTERVAL_MS = 2000;

export function startMqpetHeartbeat(heartbeat: (() => void) | undefined): () => void {
  heartbeat?.();
  const timer = globalThis.setInterval(() => heartbeat?.(), MQPET_HEARTBEAT_INTERVAL_MS);
  return () => globalThis.clearInterval(timer);
}

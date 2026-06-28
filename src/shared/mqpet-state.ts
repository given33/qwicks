// src/shared/mqpet-state.ts
// 存档模型 + 离线追回。PetDataManager.cs 没有持久化；这是补全。
import { tick, defaultState, TICK_MS, type MqPetState } from './mqpet-data';

export interface MqPetSave {
  state: MqPetState;
  inventory: { itemId: string; count: number }[];
  lastSaved: number;
  interactedDate: string; // YYYY-MM-DD; on load, if differs from today, reset interactionCount.
}

export const OFFLINE_CATCH_UP_CAP_MS = 8 * 60 * 60 * 1000;

export function todayString(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function defaultSave(now: number = Date.now()): MqPetSave {
  return { state: defaultState(), inventory: [], lastSaved: now, interactedDate: todayString(now) };
}

// Replay tick for elapsed offline time, capped. Reset daily interaction counter if a new day began.
export function applyOffline(save: MqPetSave, now: number = Date.now()): MqPetSave {
  const elapsed = Math.min(Math.max(0, now - save.lastSaved), OFFLINE_CATCH_UP_CAP_MS);
  const ticks = Math.floor(elapsed / TICK_MS);
  let state = save.state;
  for (let i = 0; i < ticks; i++) state = tick(state, now);
  const today = todayString(now);
  let interactedDate = save.interactedDate;
  if (today !== interactedDate) {
    state = { ...state, interactionCount: 0 };
    interactedDate = today;
  }
  return { ...save, state, lastSaved: now, interactedDate };
}

// Merge a loaded JSON over defaults so missing fields stay valid (mirrors pet-state-store pattern).
export function hydrateSave(raw: unknown, now: number = Date.now()): MqPetSave {
  if (!raw || typeof raw !== 'object') return defaultSave(now);
  const r = raw as Partial<MqPetSave>;
  const base = defaultSave(now);
  return {
    state: { ...base.state, ...(r.state as Partial<MqPetState> | undefined) },
    inventory: Array.isArray(r.inventory) ? r.inventory : [],
    lastSaved: typeof r.lastSaved === 'number' ? r.lastSaved : now,
    interactedDate: typeof r.interactedDate === 'string' ? r.interactedDate : todayString(now),
  };
}

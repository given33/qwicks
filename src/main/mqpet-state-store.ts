// src/main/mqpet-state-store.ts
// MQPet 状态 store：持久化 + 5s tick + 订阅广播。移植自 pet-state-store.ts 模式。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { applyOffline, defaultSave, hydrateSave, type MqPetSave } from '../shared/mqpet-state';
import { tick, applyItem, interact, startLearning, startWorking } from '../shared/mqpet-data';
import { MQ_ITEM_BY_ID } from '../shared/mqpet-catalog';

const STATE_DIR = join(homedir(), '.qwicks');
const STATE_FILE = join(STATE_DIR, 'mqpet-state.json');
const TICK_INTERVAL_MS = 5000;
const SAVE_DEBOUNCE_MS = 1000;

export class MqpetStateStore {
  private save: MqPetSave;
  private saveTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(save: MqPetSave) => void> = [];

  constructor() {
    this.save = defaultSave();
  }

  async start(): Promise<void> {
    await this.load();
    this.startTick();
  }

  async stop(): Promise<void> {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.flush();
  }

  getSnapshot(): MqPetSave {
    return this.save;
  }

  update(updater: (save: MqPetSave) => MqPetSave): void {
    this.save = updater(this.save);
    this.scheduleSave();
    this.notify();
  }

  subscribe(listener: (save: MqPetSave) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(this.save); } catch { /* listener threw */ }
    }
  }

  private async load(): Promise<void> {
    try {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      this.save = applyOffline(hydrateSave(parsed));
    } catch {
      this.save = defaultSave();
    }
    this.notify();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(this.save, null, 2));
    } catch (e) {
      console.warn('mqpet flush failed', e);
    }
  }

  private startTick(): void {
    this.tickTimer = setInterval(() => {
      this.save = { ...this.save, state: tick(this.save.state) };
      this.scheduleSave();
      this.notify();
    }, TICK_INTERVAL_MS);
  }
}

// ---- Mutations exposed to IPC ----
export function mutateUseItem(store: MqpetStateStore, itemId: string): boolean {
  const snap = store.getSnapshot();
  const inv = snap.inventory.find((i) => i.itemId === itemId);
  const item = MQ_ITEM_BY_ID[itemId];
  if (!inv || inv.count <= 0 || !item) return false;
  if (snap.state.level < item.unlockLevel) return false;
  store.update((s) => {
    const inventory = s.inventory
      .map((i) => (i.itemId === itemId ? { ...i, count: i.count - 1 } : i))
      .filter((i) => i.count > 0);
    return { ...s, state: applyItem(s.state, item), inventory };
  });
  return true;
}

export function mutateBuy(store: MqpetStateStore, itemId: string): boolean {
  const snap = store.getSnapshot();
  const item = MQ_ITEM_BY_ID[itemId];
  if (!item || Math.floor(snap.state.gold) < item.price) return false;
  store.update((s) => {
    const existing = s.inventory.find((i) => i.itemId === itemId);
    const inventory = existing
      ? s.inventory.map((i) => (i.itemId === itemId ? { ...i, count: i.count + 1 } : i))
      : [...s.inventory, { itemId, count: 1 }];
    return { ...s, state: { ...s.state, gold: s.state.gold - item.price }, inventory };
  });
  return true;
}

export function mutateWork(store: MqpetStateStore): boolean {
  const snap = store.getSnapshot();
  const next = { ...snap.state };
  if (!startWorking(next)) return false;
  store.update((s) => ({ ...s, state: next }));
  return true;
}

export function mutateLearn(store: MqpetStateStore): boolean {
  const snap = store.getSnapshot();
  const next = { ...snap.state };
  if (!startLearning(next)) return false;
  store.update((s) => ({ ...s, state: next }));
  return true;
}

export function mutateInteract(store: MqpetStateStore): void {
  store.update((s) => ({ ...s, state: interact(s.state) }));
}

let storeInstance: MqpetStateStore | null = null;
export function getMqpetStateStore(): MqpetStateStore {
  if (!storeInstance) storeInstance = new MqpetStateStore();
  return storeInstance;
}
export function resetMqpetStateStoreForTest(): void { storeInstance = null; }
export { STATE_FILE };

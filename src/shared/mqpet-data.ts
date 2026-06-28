// src/shared/mqpet-data.ts
// MQPet 数值引擎 — 纯逻辑移植自 QQpet PetDataManager.cs。
// 所有数值/tick/结算逻辑在此，主进程 store 与渲染器都依赖它。可单元测试。

export type MqPetActivity = 'Idle' | 'Working' | 'Learning' | 'Playing';
export type MqPetStage = 'Egg' | 'Toddler' | 'Mature';

export interface MqPetState {
  level: number;
  growth: number;
  gold: number;
  hunger: number;
  cleanliness: number;
  health: number;
  mood: number;
  stamina: number;
  intelligence: number;
  stressResistance: number;
  charm: number;
  activity: MqPetActivity;
  workTimer: number;
  workTarget: number;
  interactionCount: number;
  charmBuffs: { amount: number; expiresAt: number }[];
}

// StatGrowthConfig (PetDataManager.cs) — base/growthPerLevel/阶段封顶。
interface StatCfg { base: number; growth: number; cap: Record<MqPetStage, number>; }

export const STAT_CONFIG = {
  hungerClean:      { base: 3000, growth: 100, cap: { Egg: 4000, Toddler: 6000, Mature: 9000 } },
  stamina:          { base: 100,  growth: 5,   cap: { Egg: 150,  Toddler: 250,  Mature: 400 } },
  health:           { base: 100,  growth: 2,   cap: { Egg: 120,  Toddler: 160,  Mature: 200 } },
  mood:             { base: 1000, growth: 50,  cap: { Egg: 1500, Toddler: 2500, Mature: 4000 } },
  intelligence:     { base: 100,  growth: 5,   cap: { Egg: 150,  Toddler: 300,  Mature: 500 } },
  stressResistance: { base: 100,  growth: 5,   cap: { Egg: 150,  Toddler: 300,  Mature: 500 } },
  charm:            { base: 0,    growth: 5,   cap: { Egg: 100,  Toddler: 100,  Mature: 100 } },
} as const;

// 时间引擎 (PetDataManager.cs 字段)。tickInterval 秒，对应 InvokeRepeating。
export const ENGINE = {
  tickInterval: 5,         // 秒
  hoursToStarve: 8,
  hoursToDirty: 24,
  hoursToDepress: 4,
  minMoodDrainRate: 0.2,
} as const;

export const MAX_INTERACTIONS_PER_DAY = 6;
export const TICK_MS = ENGINE.tickInterval * 1000;

export function stageOf(level: number): MqPetStage {
  if (level < 10) return 'Egg';
  if (level < 30) return 'Toddler';
  return 'Mature';
}

export function statLimit(level: number, cfg: StatCfg): number {
  const a = cfg.base + (level - 1) * cfg.growth;
  return Math.min(a, cfg.cap[stageOf(level)]);
}

export function maxGrowthFor(level: number): number {
  return level * 100;
}

export function isSick(s: MqPetState): boolean {
  return s.health < 60 || s.hunger <= 0 || s.cleanliness <= 0;
}

export function defaultState(): MqPetState {
  return {
    level: 1, growth: 0, gold: 100,
    hunger: 1000, cleanliness: 1000, health: 100, mood: 1000,
    stamina: 100, intelligence: 25, stressResistance: 0, charm: 0,
    activity: 'Idle', workTimer: 0, workTarget: 0,
    interactionCount: 0, charmBuffs: [],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function tick(state: MqPetState, now: number = Date.now()): MqPetState {
  const s: MqPetState = { ...state, charmBuffs: state.charmBuffs.filter((b) => b.expiresAt > now) };
  const lvl = s.level;
  const maxHunger = statLimit(lvl, STAT_CONFIG.hungerClean);
  const maxMood = statLimit(lvl, STAT_CONFIG.mood);
  const maxStam = statLimit(lvl, STAT_CONFIG.stamina);
  const maxHealth = statLimit(lvl, STAT_CONFIG.health);
  const maxStress = statLimit(lvl, STAT_CONFIG.stressResistance);

  const tps = (h: number) => (h * 3600) / ENGINE.tickInterval;
  const hungerRate = maxHunger / tps(ENGINE.hoursToStarve);
  const dirtyRate = maxHunger / tps(ENGINE.hoursToDirty);
  const moodBase = maxMood / tps(ENGINE.hoursToDepress);
  const stamRate = maxStam / tps(2);
  const stressRatio = clamp(maxStress > 0 ? s.stressResistance / maxStress : 0, 0, 1);
  const moodRate = moodBase * (1 - stressRatio * (1 - ENGINE.minMoodDrainRate));

  let hRate = hungerRate, dRate = dirtyRate, mRate = moodRate;

  if (s.activity === 'Working') {
    hRate *= 2; dRate *= 1.5; mRate *= 1.2;
    s.stamina -= stamRate;
    addGrowth(s, 1.2);
    s.workTimer += 1;
    if (s.stamina <= 0) { s.stamina = 0; settleWork(s); }
    else if (s.workTimer >= s.workTarget) settleWork(s);
  } else if (s.activity === 'Learning') {
    hRate *= 1.5;
    addGrowth(s, 1.5);
    s.intelligence += 1;
    s.workTimer += 1;
    if (s.hunger <= 0) s.health -= 5;
    if (s.workTimer >= s.workTarget) settleLearn(s);
  } else {
    addGrowth(s, s.mood >= 900 ? 2 : 1);
    s.stamina += stamRate * 0.5;
  }

  s.hunger -= hRate;
  s.cleanliness -= dRate;
  s.mood -= mRate;
  if (s.hunger <= 0 || s.cleanliness <= 0) s.health -= maxHealth / tps(2);
  return clampAll(s, lvl);
}

function addGrowth(s: MqPetState, amount: number): void {
  s.growth += amount;
  while (s.growth >= maxGrowthFor(s.level) && s.level < 100) {
    s.growth -= maxGrowthFor(s.level);
    s.level += 1;
  }
}

export function settleWork(s: MqPetState): void {
  const wage = s.level < 15 ? 20 : s.level >= 30 ? 36 : 30;
  const cost = s.level <= 5 ? 18 : s.level <= 11 ? 22 : 26;
  s.gold += (wage - cost) * s.workTimer;
  s.activity = 'Idle';
  s.workTimer = 0;
  s.workTarget = 0;
}

export function settleLearn(s: MqPetState): void {
  s.gold += s.level < 10 ? 20 : s.level < 20 ? 50 : 100;
  s.activity = 'Idle';
  s.workTimer = 0;
  s.workTarget = 0;
}

export function startWorking(s: MqPetState, hours = 4): boolean {
  if (isSick(s) || s.activity !== 'Idle' || s.stamina <= 20) return false;
  s.activity = 'Working'; s.workTarget = hours; s.workTimer = 0;
  return true;
}

export function startLearning(s: MqPetState, hours = 2): boolean {
  if (isSick(s) || s.activity !== 'Idle') return false;
  s.activity = 'Learning'; s.workTarget = hours; s.workTimer = 0;
  return true;
}

export function applyItem(
  s: MqPetState,
  item: { addHunger: number; addCleanliness: number; addHealth: number; addMood: number; addCharm: number; addGrowth: number; buffDuration: number; },
  now: number = Date.now(),
): MqPetState {
  const next = { ...s };
  next.hunger += item.addHunger;
  next.cleanliness += item.addCleanliness;
  next.health += item.addHealth;
  next.mood += item.addMood;
  if (item.addCharm > 0) {
    if (item.buffDuration > 0) {
      next.charmBuffs = [...next.charmBuffs, { amount: item.addCharm, expiresAt: now + item.buffDuration * 1000 }];
    } else {
      next.charm += item.addCharm;
    }
  }
  if (item.addGrowth > 0) addGrowth(next, item.addGrowth);
  return clampAll(next, next.level);
}

export function interact(s: MqPetState): MqPetState {
  if (s.interactionCount >= MAX_INTERACTIONS_PER_DAY) return s;
  const next = { ...s, mood: s.mood + 200, interactionCount: s.interactionCount + 1 };
  return clampAll(next, next.level);
}

function clampAll(s: MqPetState, lvl: number): MqPetState {
  s.hunger = clamp(s.hunger, 0, statLimit(lvl, STAT_CONFIG.hungerClean));
  s.cleanliness = clamp(s.cleanliness, 0, statLimit(lvl, STAT_CONFIG.hungerClean));
  s.mood = clamp(s.mood, 0, statLimit(lvl, STAT_CONFIG.mood));
  s.health = clamp(s.health, 0, statLimit(lvl, STAT_CONFIG.health));
  s.stamina = clamp(s.stamina, 0, statLimit(lvl, STAT_CONFIG.stamina));
  s.intelligence = clamp(s.intelligence, 0, statLimit(lvl, STAT_CONFIG.intelligence));
  s.stressResistance = clamp(s.stressResistance, 0, statLimit(lvl, STAT_CONFIG.stressResistance));
  s.charm = clamp(s.charm, 0, statLimit(lvl, STAT_CONFIG.charm));
  return s;
}

export function effectiveCharm(s: MqPetState): number {
  return s.charm + s.charmBuffs.reduce((sum, b) => sum + b.amount, 0);
}

import { isSick, type MqPetActivity, type MqPetState } from './mqpet-data';

export type MqpetActivityMode = 'work' | 'learn';

export interface ActivityStartStatus {
  ok: boolean;
  reason?: string;
}

export interface ActivityProgress {
  current: number;
  target: number;
  percent: number;
}

const ACTIVITY_LABEL: Record<MqPetActivity, string> = {
  Idle: '休息',
  Working: '打工',
  Learning: '学习',
  Playing: '玩耍',
};

export function workWageAndCostForLevel(level: number): { wage: number; cost: number } {
  const wage = level < 15 ? 20 : level >= 30 ? 36 : 30;
  const cost = level <= 5 ? 18 : level <= 11 ? 22 : 26;
  return { wage, cost };
}

export function workNetGoldPerTick(level: number): number {
  const { wage, cost } = workWageAndCostForLevel(level);
  return wage - cost;
}

export function learnRewardForLevel(level: number): number {
  if (level < 10) return 20;
  if (level < 20) return 50;
  return 100;
}

export function activityProgress(state: MqPetState): ActivityProgress {
  const target = Math.max(0, state.workTarget);
  const current = Math.max(0, state.workTimer);
  const percent = target <= 0 ? 0 : Math.min(100, Math.round((current / target) * 100));
  return { current, target, percent };
}

export function canStartActivity(state: MqPetState, mode: MqpetActivityMode): ActivityStartStatus {
  if (isSick(state)) return { ok: false, reason: mode === 'work' ? '生病时不能打工' : '生病时不能学习' };
  if (state.activity !== 'Idle') return { ok: false, reason: `当前正在${ACTIVITY_LABEL[state.activity]}中` };
  if (mode === 'work' && state.stamina <= 20) {
    return { ok: false, reason: '体力不足，休息到 20 以上再打工' };
  }
  return { ok: true };
}

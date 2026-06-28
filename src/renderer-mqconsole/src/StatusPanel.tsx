// src/renderer-mqconsole/src/StatusPanel.tsx
import { stageOf, statLimit, STAT_CONFIG, effectiveCharm, maxGrowthFor } from '@shared/mqpet-data';
import type { MqPetSave } from '@shared/mqpet-state';

const STAGE_LABEL: Record<string, string> = { Egg: '胚胎期', Toddler: '幼儿期', Mature: '成熟期' };
const ACTIVITY_LABEL: Record<string, string> = { Idle: '挂机/休息', Working: '打工中', Learning: '学习中', Playing: '玩耍中' };

export function StatusPanel({ save }: { save: MqPetSave }): React.ReactElement {
  const s = save.state;
  const lvl = s.level;
  const row = (label: string, val: number, max: number): React.ReactElement => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span>{label}</span>
      <span>{Math.floor(val)} / {Math.floor(max)}</span>
    </div>
  );
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
        等级 {lvl} | {STAGE_LABEL[stageOf(lvl)]} | {ACTIVITY_LABEL[s.activity]}
      </div>
      <div style={{ marginBottom: 8 }}>元宝: {Math.floor(s.gold)} | 经验: {Math.floor(s.growth)} / {maxGrowthFor(lvl)}</div>
      {row('健康', s.health, statLimit(lvl, STAT_CONFIG.health))}
      {row('心情', s.mood, statLimit(lvl, STAT_CONFIG.mood))}
      {row('饥饿', s.hunger, statLimit(lvl, STAT_CONFIG.hungerClean))}
      {row('清洁', s.cleanliness, statLimit(lvl, STAT_CONFIG.hungerClean))}
      {row('体力', s.stamina, statLimit(lvl, STAT_CONFIG.stamina))}
      {row('智力', s.intelligence, statLimit(lvl, STAT_CONFIG.intelligence))}
      {row('抗压', s.stressResistance, statLimit(lvl, STAT_CONFIG.stressResistance))}
      {row('魅力', effectiveCharm(s), statLimit(lvl, STAT_CONFIG.charm))}
    </div>
  );
}

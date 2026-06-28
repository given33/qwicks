import { stageOf, statLimit, STAT_CONFIG, effectiveCharm, maxGrowthFor } from '@shared/mqpet-data';
import type { MqPetSave } from '@shared/mqpet-state';

const STAGE_LABEL: Record<string, string> = { Egg: '蛋壳期', Toddler: '幼年期', Mature: '成熟期' };
const ACTIVITY_LABEL: Record<string, string> = {
  Idle: '休息中',
  Working: '打工中',
  Learning: '学习中',
  Playing: '互动中',
};

function StatRow({ label, val, max }: { label: string; val: number; max: number }): React.ReactElement {
  const percent = Math.max(0, Math.min(100, (val / Math.max(1, max)) * 100));
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
        <span>{label}</span>
        <span>{Math.floor(val)} / {Math.floor(max)}</span>
      </div>
      <div style={{ height: 8, border: '1px solid #c98a2b', background: 'rgba(255,255,255,0.78)' }}>
        <div style={{ height: '100%', width: `${percent}%`, background: percent < 25 ? '#e57373' : '#7cc26b' }} />
      </div>
    </div>
  );
}

export function StatusPanel({ save }: { save: MqPetSave }): React.ReactElement {
  const s = save.state;
  const lvl = s.level;
  return (
    <div style={{ padding: 12, fontSize: 13, color: '#5a3a10' }}>
      <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
        等级 {lvl} | {STAGE_LABEL[stageOf(lvl)]} | {ACTIVITY_LABEL[s.activity]}
      </div>
      <div style={{ marginBottom: 8 }}>
        元宝: {Math.floor(s.gold)} | 经验: {Math.floor(s.growth)} / {maxGrowthFor(lvl)}
      </div>
      <StatRow label="健康" val={s.health} max={statLimit(lvl, STAT_CONFIG.health)} />
      <StatRow label="心情" val={s.mood} max={statLimit(lvl, STAT_CONFIG.mood)} />
      <StatRow label="饥饿" val={s.hunger} max={statLimit(lvl, STAT_CONFIG.hungerClean)} />
      <StatRow label="清洁" val={s.cleanliness} max={statLimit(lvl, STAT_CONFIG.hungerClean)} />
      <StatRow label="体力" val={s.stamina} max={statLimit(lvl, STAT_CONFIG.stamina)} />
      <StatRow label="智力" val={s.intelligence} max={statLimit(lvl, STAT_CONFIG.intelligence)} />
      <StatRow label="抗压" val={s.stressResistance} max={statLimit(lvl, STAT_CONFIG.stressResistance)} />
      <StatRow label="魅力" val={effectiveCharm(s)} max={statLimit(lvl, STAT_CONFIG.charm)} />
    </div>
  );
}

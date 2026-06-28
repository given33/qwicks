import {
  activityProgress,
  canStartActivity,
  learnRewardForLevel,
  workNetGoldPerTick,
  workWageAndCostForLevel,
  type MqpetActivityMode,
} from '@shared/mqpet-activity';
import type { MqPetSave } from '@shared/mqpet-state';

type Bridge = {
  work: () => Promise<unknown>;
  learn: () => Promise<unknown>;
};

function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

const MODE_LABEL: Record<MqpetActivityMode, string> = {
  work: '打工',
  learn: '学习',
};

export function ActivityPanel({
  save,
  mode,
  onModeChange,
}: {
  save: MqPetSave;
  mode: MqpetActivityMode;
  onModeChange: (mode: MqpetActivityMode) => void;
}): React.ReactElement {
  const state = save.state;
  const progress = activityProgress(state);
  const startStatus = canStartActivity(state, mode);
  const { wage, cost } = workWageAndCostForLevel(state.level);
  const workNet = workNetGoldPerTick(state.level);
  const learnReward = learnRewardForLevel(state.level);
  const activeMode: MqpetActivityMode | null = state.activity === 'Working'
    ? 'work'
    : state.activity === 'Learning'
      ? 'learn'
      : null;
  const isCurrentModeRunning = activeMode === mode;

  function start(): void {
    if (mode === 'work') void getBridge()?.work();
    else void getBridge()?.learn();
  }

  return (
    <div style={{ padding: 12, fontSize: 13, color: '#5a3a10' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['work', 'learn'] as MqpetActivityMode[]).map((nextMode) => (
          <button
            key={nextMode}
            onClick={() => onModeChange(nextMode)}
            style={{
              border: '1px solid #c98a2b',
              background: mode === nextMode ? '#ffe082' : 'rgba(255,255,255,0.72)',
              color: '#5a3a10',
              cursor: 'pointer',
              fontWeight: mode === nextMode ? 'bold' : 'normal',
              padding: '3px 12px',
            }}
          >
            {MODE_LABEL[nextMode]}
          </button>
        ))}
      </div>

      <div style={{ border: '1px solid #e0a64a', background: 'rgba(255,255,255,0.72)', padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
          {MODE_LABEL[mode]} | 等级 {state.level} | 当前 {state.activity}
        </div>
        <div>体力 {Math.floor(state.stamina)} | 饥饿 {Math.floor(state.hunger)} | 清洁 {Math.floor(state.cleanliness)} | 健康 {Math.floor(state.health)}</div>
        <div style={{ marginTop: 6 }}>
          {mode === 'work'
            ? `工资 ${wage} - 成本 ${cost}，每 tick 净得 ${workNet} 元宝，默认 4 tick`
            : `奖励 ${learnReward} 元宝，每 tick 智力 +1、成长 +1.5，默认 2 tick`}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span>{activeMode ? `${MODE_LABEL[activeMode]}进度` : '当前进度'}</span>
          <span>{progress.current}/{progress.target || 0}</span>
        </div>
        <div style={{ height: 12, border: '1px solid #c98a2b', background: '#fff7d6' }}>
          <div style={{ height: '100%', width: `${progress.percent}%`, background: '#f3b33d' }} />
        </div>
      </div>

      <button
        disabled={!startStatus.ok || isCurrentModeRunning}
        onClick={start}
        style={{
          width: '100%',
          border: '2px solid #c98a2b',
          background: startStatus.ok && !isCurrentModeRunning ? '#ffe082' : '#e6ded0',
          color: '#5a3a10',
          cursor: startStatus.ok && !isCurrentModeRunning ? 'pointer' : 'not-allowed',
          fontWeight: 'bold',
          padding: '7px 0',
        }}
      >
        {isCurrentModeRunning ? `${MODE_LABEL[mode]}中` : `开始${MODE_LABEL[mode]}`}
      </button>

      {!startStatus.ok && (
        <div style={{ marginTop: 8, color: '#9b3a1b', textAlign: 'center' }}>{startStatus.reason}</div>
      )}
    </div>
  );
}

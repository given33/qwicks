/**
 * Turn 时间状态机（纯函数，无 React 依赖）。
 *
 * 单一计时器从「第一个 reasoning delta」起跳，全程不重置。
 * 思考只是处理全过程的开头一段；吐字只换标签，秒数延续。
 *
 * 详见 docs/superpowers/specs/2026-06-25-turn-timer-state-machine-design.md
 */
export type TurnPhase =
  | 'idle'
  | 'thinking_wait'
  | 'thinking_reason'
  | 'processing'
  | 'done'

export type TurnTimerInput = {
  /** busy || turnPending || hasLiveStream —— turn 是否还在运行 */
  isProcessing: boolean
  /** !!liveReasoning.trim() —— 是否有思考流（仅 processing 期有意义） */
  hasLiveReasoning?: boolean
  /** !!liveAssistant.trim() —— 是否已有回复文字（仅 processing 期有意义） */
  hasLiveAssistant?: boolean
  /** turnReasoningFirstAtByUserId[userId] —— 首个 reasoning delta 时刻（秒数起跳点） */
  reasoningStartedAt?: number
  /** turnStartedAtByUserId[userId] —— 无 reasoning 时的兜底起点 */
  turnStartedAt?: number
  /** turnDurationByUserId[userId] —— turn 结束时固化的总时长（DONE 优先用） */
  recordedDurationMs?: number
  /** 父组件 1s tick 的 now（epoch ms） */
  nowMs: number
}

export type TurnTimerState = {
  phase: TurnPhase
  /** 仅 thinking_wait 为 undefined（不显示秒数）；其余态有值则显示 */
  displayMs?: number
  /** i18n key */
  labelKey: 'thinkingNow' | 'thinkingWithSeconds' | 'processingWithDuration' | 'processedWithDuration'
}

/**
 * 计算当前应显示的时间态。优先级：done > processing > thinking_reason > thinking_wait。
 * 计时起点优先 reasoningStartedAt，无 reasoning 用 turnStartedAt 兜底。
 */
export function deriveTurnTimer(input: TurnTimerInput): TurnTimerState {
  const { isProcessing, hasLiveReasoning, hasLiveAssistant, nowMs } = input
  const reasoningStartedAt = numOrUndef(input.reasoningStartedAt)
  const turnStartedAt = numOrUndef(input.turnStartedAt)
  const recordedDurationMs = numOrUndef(input.recordedDurationMs)

  // DONE: turn 结束。优先用固化的总时长；否则从起点推算。
  if (!isProcessing) {
    const displayMs =
      recordedDurationMs ??
      (reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined) ??
      (turnStartedAt != null ? Math.max(0, nowMs - turnStartedAt) : undefined)
    if (
      displayMs == null &&
      reasoningStartedAt == null &&
      turnStartedAt == null &&
      recordedDurationMs == null
    ) {
      return { phase: 'idle', displayMs: undefined, labelKey: 'processedWithDuration' }
    }
    return { phase: 'done', displayMs, labelKey: 'processedWithDuration' }
  }

  // PROCESSING: 已有回复文字。秒数延续（用同一 reasoningStartedAt，不重置）。
  if (hasLiveAssistant) {
    const displayMs =
      (reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined) ??
      (turnStartedAt != null ? Math.max(0, nowMs - turnStartedAt) : undefined)
    return { phase: 'processing', displayMs, labelKey: 'processingWithDuration' }
  }

  // THINKING_REASON: 有思考流、还没吐字。秒数从 reasoningStartedAt 起。
  if (hasLiveReasoning) {
    const displayMs =
      reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined
    return { phase: 'thinking_reason', displayMs, labelKey: 'thinkingWithSeconds' }
  }

  // THINKING_WAIT: 本地乐观渲染期，模型还没真正收到任务。无秒数。
  return { phase: 'thinking_wait', displayMs: undefined, labelKey: 'thinkingNow' }
}

function numOrUndef(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

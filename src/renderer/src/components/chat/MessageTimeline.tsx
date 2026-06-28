import type { ReactElement, RefObject } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerUpLeft } from 'lucide-react'
import type {
  ChatBlock,
  ConversationDetailLevel,
  RawRuntimeEvent,
  RuntimeConnectionStatus,
  TraceSpan
} from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { summarizeToolActivity, formatToolActivitySummary } from './tool-activity-summary'
import { deriveTurnTimer } from './turn-timer'
import type { TurnTimerState } from './turn-timer'
import {
  AnimatedWorkLogo,
  IQWICKS_WORK_LOGO_VARIANT_LABEL_KEYS,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useIqwicksWorkLogoVariant,
  useWorkLogoSwimMode
} from './AnimatedWorkLogo'
import type { UiPluginLabelKey } from '@shared/ui-plugin'
import { useUiPluginWorkLabel } from '../../store/ui-plugin-store'
import {
  groupTurns,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'

export { summarizeToolBlock } from './message-timeline-process'

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
  devPreviewCard?: ReactElement | null
  /** Disables the inline Review Plan card's Build action while a turn runs. */
  planActionsBusy?: boolean
  /** Runs the active plan (Build button on the inline Review Plan). */
  onBuildPlan?: () => void
  /** Opens/focuses the Plan panel (Open button on the inline card). */
  onOpenPlan?: () => void
  compactCards?: boolean
  conversationDetailLevel?: ConversationDetailLevel
  traceSpansByTurnId?: Record<string, Record<string, TraceSpan>>
  runtimeEventsByTurnId?: Record<string, RawRuntimeEvent[]>
  /** 模型连接重连中:有值时覆盖 live block 显示重连进度。 */
  modelReconnecting?: { attempt: number; maxAttempts: number; reason: string } | null
}

type CompactionTimelineBlock = Extract<ChatBlock, { kind: 'compaction' }>

const TURN_PAGE_SIZE = 18
const AUTO_COLLAPSE_THRESHOLD = 24

export function goalTimelinePaddingClass(route: 'chat' | 'claw', hasActiveGoal: boolean): string {
  return route === 'chat' && hasActiveGoal ? 'pb-32 md:pb-40' : 'pb-10'
}

/** A turn has "visible assistant content" once any assistant block carries non-empty
 * content text (excluding <think>). Drives the THINKING→PROCESSING transition. */
function assistantHasContent(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind !== 'assistant') return false
    return splitThink(block.text).content.trim().length > 0
  })
}

export function liveTurnProgressClass(hasActiveGoal: boolean): string {
  return hasActiveGoal
    ? 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted mb-16 md:mb-20'
    : 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted'
}

function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

function turnPreview(turn: Turn, fallback: string): string {
  const text = turn.user?.text.trim() ?? ''
  if (!text) return fallback
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > 48 ? `${oneLine.slice(0, 47).trimEnd()}...` : oneLine
}

function processBlockHasError(block: ChatBlock): boolean {
  return (
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'review' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error') ||
    (block.kind === 'system' && block.severity === 'error')
  )
}

function compactionDividerLabel(
  block: CompactionTimelineBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.status === 'running') return t('compactionRunning')
  if (block.status === 'error') return block.summary || t('compactionFailed')
  return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
}

function CompactionDivider({ block }: { block: CompactionTimelineBlock }): ReactElement {
  const { t } = useTranslation('common')
  const error = block.status === 'error'
  return (
    <div
      role={block.status === 'running' ? 'status' : undefined}
      aria-live={block.status === 'running' ? 'polite' : undefined}
      className="flex w-full items-center gap-4 py-2"
    >
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-red-200/80 dark:bg-red-900/50' : 'bg-ds-border-muted/80'}`} />
      <span
        className={`shrink-0 text-[15px] font-semibold leading-6 ${
          error ? 'text-red-600 dark:text-red-300' : 'text-ds-faint'
        }`}
      >
        {compactionDividerLabel(block, t)}
      </span>
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-red-200/80 dark:bg-red-900/50' : 'bg-ds-border-muted/80'}`} />
    </div>
  )
}

export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  focusModeEnabled = false,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  compactCards = false,
  conversationDetailLevel = 'technical',
  traceSpansByTurnId = {},
  runtimeEventsByTurnId = {},
  modelReconnecting = null
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    route,
    workspaceRoot,
    chooseWorkspace,
    activeClawChannel,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    activeThreadGoal,
    activeThread
  } = useTimelineStores(activeThreadId)

  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnRefMap = useRef(new Map<string, HTMLDivElement>())

  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length
  ].join(':')
  const {
    visibleTurnCount,
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns
  } = useTimelineScroll({
    containerRef,
    endRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    totalTurns: turns.length,
    busy,
    scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: currentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const visibleTurnAnchors = useMemo(
    () => {
      const anchors: { key: string; label: string; title: string }[] = []
      let questionIndex = turns
        .slice(0, hiddenTurnCount)
        .filter((turn) => turn.user)
        .length

      visibleTurns.forEach((turn, index) => {
        if (!turn.user) return
        questionIndex += 1
        const absoluteTurnIndex = hiddenTurnCount + index
        const key = stableTurnKey(turn, absoluteTurnIndex)
        anchors.push({
          key,
          label: String(questionIndex),
          title: turnPreview(turn, t('timelineJumpTurn', { index: questionIndex }))
        })
      })
      return anchors
    },
    [hiddenTurnCount, t, turns, visibleTurns]
  )
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId])

  const jumpToTurn = (key: string): void => {
    const target = turnRefMap.current.get(key)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div ref={containerRef} className="ds-no-drag relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {visibleTurnAnchors.length > 2 ? (
        <nav
          aria-label={t('timelineJumpRailLabel')}
          className="timeline-jump-rail"
        >
          {visibleTurnAnchors.map((anchor) => (
            <button
              key={anchor.key}
              type="button"
              className="timeline-jump-rail-button"
              title={anchor.title}
              aria-label={anchor.title}
              onClick={() => jumpToTurn(anchor.key)}
            >
              {anchor.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={`ds-message-timeline-content ds-chat-column-inset mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 pt-8 ${
        goalTimelinePaddingClass(heroRoute, Boolean(activeThreadGoal))
      }`}>
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            focusModeEnabled={focusModeEnabled}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && currentTurnUserId === userId)
          const startedAt = userId ? turnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? turnDurationByUserId[userId] : undefined
          const durationMs =
            recordedDuration ??
            (isLive && typeof startedAt === 'number'
              ? Math.max(0, tickNow - startedAt)
              : undefined)
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const turnPending = threadHasPendingRuntimeWork(turn.blocks)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          // Derive the turn timer state once here; MessageTurn consumes it.
          // Live reasoning/assistant flags are only meaningful for the active turn.
          const liveSplit = isLatestTurn ? splitThink(live) : null
          const turnTimer = deriveTurnTimer({
            isProcessing: (busy && isLatestTurn) || turnPending || hasLiveStream,
            hasLiveReasoning: isLatestTurn && (!!liveReasoning.trim() || !!(liveSplit?.think.trim())),
            hasLiveAssistant: isLatestTurn
              ? !!(liveSplit?.content.trim())
              : assistantHasContent(turn.blocks),
            reasoningStartedAt: reasoningFirst,
            turnStartedAt: startedAt,
            recordedDurationMs: durationMs,
            nowMs: tickNow
          })
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          const turnKey = stableTurnKey(turn, absoluteTurnIndex)
          return (
            <div
              key={turnKey}
              ref={(node) => {
                if (node) {
                  turnRefMap.current.set(turnKey, node)
                } else {
                  turnRefMap.current.delete(turnKey)
                }
              }}
              className="scroll-mt-6"
            >
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                isProcessing={(busy && isLatestTurn) || turnPending || hasLiveStream}
                liveReasoning={isLatestTurn ? liveReasoning : ''}
                live={isLatestTurn ? live : ''}
                turnTimer={turnTimer}
                devPreviewCard={isLatestTurn ? devPreviewCard : null}
                planActionsBusy={planActionsBusy}
                onBuildPlan={onBuildPlan}
                onOpenPlan={onOpenPlan}
                viewportRef={containerRef}
                nowMs={tickNow}
                compactCards={compactCards}
                conversationDetailLevel={conversationDetailLevel}
                traceSpansByTurnId={traceSpansByTurnId}
                runtimeEventsByTurnId={runtimeEventsByTurnId}
              />
            </div>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && turns.length > AUTO_COLLAPSE_THRESHOLD && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning || modelReconnecting) ? (
          (() => {
            const liveSplit = splitThink(modelReconnecting ? '' : live)
            const liveTurnTimer = deriveTurnTimer({
              isProcessing: busy,
              hasLiveReasoning: !modelReconnecting && (!!liveReasoning.trim() || !!liveSplit.think.trim()),
              hasLiveAssistant: !modelReconnecting && !!liveSplit.content.trim(),
              reasoningStartedAt: currentTurnUserId
                ? turnReasoningFirstAtByUserId[currentTurnUserId]
                : undefined,
              turnStartedAt: currentTurnUserId
                ? turnStartedAtByUserId[currentTurnUserId]
                : undefined,
              nowMs: tickNow
            })
            return (
              <MemoMessageTurn
                turn={{ blocks: [] }}
                isProcessing={busy}
                liveReasoning={modelReconnecting ? '' : liveReasoning}
                live={modelReconnecting ? t('modelReconnecting', { attempt: modelReconnecting.attempt, max: modelReconnecting.maxAttempts }) : live}
                devPreviewCard={devPreviewCard}
                viewportRef={containerRef}
                compactCards={compactCards}
                turnTimer={liveTurnTimer}
                nowMs={tickNow}
                conversationDetailLevel={conversationDetailLevel}
                traceSpansByTurnId={traceSpansByTurnId}
                runtimeEventsByTurnId={runtimeEventsByTurnId}
              />
            )
          })()
        ) : null}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
    </div>
  )
}

function MessageTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  turnTimer,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  viewportRef,
  nowMs,
  compactCards = false,
  conversationDetailLevel,
  traceSpansByTurnId,
  runtimeEventsByTurnId
}: {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  turnTimer: TurnTimerState
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  onBuildPlan?: () => void
  onOpenPlan?: () => void
  viewportRef: RefObject<HTMLDivElement | null>
  /** Ticking clock for live duration badges; only meaningful while processing. */
  nowMs?: number
  compactCards?: boolean
  conversationDetailLevel: ConversationDetailLevel
  traceSpansByTurnId: Record<string, Record<string, TraceSpan>>
  runtimeEventsByTurnId: Record<string, RawRuntimeEvent[]>
}): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const forkThreadFromTurn = useChatStore((s) => s.forkThreadFromTurn)
  const { t } = useTranslation('common')
  const [forking, setForking] = useState(false)
  // Inline Review Plan card: surfaced under a turn that produced a
  // successful `create_plan` result so the user can open/build the plan
  // without leaving the conversation.
  const planResult = useMemo(() => {
    if (isProcessing) return null
    for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
      const block = turn.blocks[index]
      if (block.kind !== 'tool' || block.status !== 'success') continue
      const meta = extractPlanMetadataFromBlock(block)
      if (meta) return meta
    }
    return null
  }, [turn.blocks, isProcessing])
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const [workExpandedOverride, setWorkExpandedOverride] = useState<boolean | null>(null)

  const { processBlocks, assistantContentBlocks, generatedFileBlocks, turnFileChanges } = useMemo(
    () =>
      deriveTurnSections({
        turn,
        isProcessing,
        liveProcessText,
        liveContent,
        workspaceRoot
      }),
    [turn, isProcessing, liveProcessText, liveContent, workspaceRoot]
  )
  const compactionBlocks = useMemo(
    () => processBlocks.filter((block): block is CompactionTimelineBlock => block.kind === 'compaction'),
    [processBlocks]
  )
  const workProcessBlocks = useMemo(
    () => processBlocks.filter((block) => block.kind !== 'compaction'),
    [processBlocks]
  )
  const onlyCompactionProcess = processBlocks.length > 0 && workProcessBlocks.length === 0
  const hasProcessError = workProcessBlocks.some(processBlockHasError)
  const workExpanded = hasProcessError || (workExpandedOverride ?? isProcessing)
  // Codex-style mixed activity summary for the collapsed hint (done + folded).
  const activitySummary = useMemo(
    () => formatToolActivitySummary(summarizeToolActivity(workProcessBlocks), t),
    [workProcessBlocks, t]
  )
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )

  const processSections = useMemo(
    () => (workExpanded ? groupProcessSections(workProcessBlocks, isProcessing) : []),
    [workProcessBlocks, workExpanded, isProcessing]
  )
  // Show the live assistant bubble whenever the SSE has streamed any text
  // into `live`. We deliberately do NOT gate on `isProcessing`: the
  // processing indicator (WorkMetaRow above) already covers "the agent is
  // working", and hiding the streaming text here causes real-time updates
  // (Feishu bot streaming) to appear only after turn_completed, which the
  // user perceives as a long delay.
  // Note: `live` is the generic SSE sink output across ALL channels
  // (QWicks runtime turns, claw channel replies from feishu/weixin/etc),
  // not feishu-specific. Removing the !isProcessing gate is intentional
  // for all streaming paths, not just feishu.
  const showLiveAssistant = !!liveContent.trim()
  const forkTurnId =
    turn.user?.turnId?.trim() ||
    [...assistantContentBlocks].reverse().find((block) => block.turnId?.trim())?.turnId?.trim() ||
    ''
  const forkActionBlockId =
    !isProcessing && forkTurnId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined

  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const showProcessWork = conversationDetailLevel !== 'simple'
  const panelTurnId = turnIdForPanels(turn)
  const traceSpans = panelTurnId ? traceSpansByTurnId[panelTurnId] : undefined
  const rawEvents = panelTurnId ? runtimeEventsByTurnId[panelTurnId] : undefined
  const hasProcess = showProcessWork && ((isProcessing && !onlyCompactionProcess) || workProcessBlocks.length > 0)
  const showLiveProgress = isProcessing && !onlyCompactionProcess
  const forkFromTurn = async (): Promise<void> => {
    if (!forkTurnId || forking) return
    setForking(true)
    try {
      await forkThreadFromTurn(forkTurnId)
    } finally {
      setForking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            timer={turnTimer}
            stepCount={workProcessBlocks.length}
            activitySummary={activitySummary}
            expanded={workExpanded}
            collapsible={!hasProcessError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  viewportRef={viewportRef}
                  nowMs={nowMs}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {assistantContentBlocks.map((block) => (
        <MessageBubble
          key={block.id}
          block={block}
          forkAction={
            block.id === forkActionBlockId
              ? {
                  busy: forking,
                  onFork: () => {
                    void forkFromTurn()
                  }
                }
              : undefined
          }
        />
      ))}

      {showLiveAssistant ? (
        <MessageBubble block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }} />
      ) : null}

      {showProcessWork ? <MultiAgentPanel blocks={workProcessBlocks} /> : null}

      {conversationDetailLevel === 'debug' ? (
        <DebugTracePanel spans={traceSpans} rawEvents={rawEvents} />
      ) : null}

      <GeneratedFilesPanel blocks={generatedFileBlocks} />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {showProcessWork && showLiveProgress ? <LiveTurnProgressRow hasActiveGoal={Boolean(activeThreadGoal)} /> : null}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          onOpen={onOpenPlan}
          onBuild={onBuildPlan}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} compact={compactCards} />
      ) : null}

      {/* The compaction marker renders LAST so "已压缩上下文" sits at the very
          bottom of the turn it belongs to — i.e. the bottom of the latest turn
          when the compaction just happened — rather than wedged between the
          user's question and the assistant's answer. */}
      {compactionBlocks.map((block) => (
        <CompactionDivider key={block.id} block={block} />
      ))}
    </div>
  )
}

function turnIdForPanels(turn: Turn): string {
  if (turn.user?.turnId?.trim()) return turn.user.turnId.trim()
  for (const block of turn.blocks) {
    if ('turnId' in block && typeof block.turnId === 'string' && block.turnId.trim()) {
      return block.turnId.trim()
    }
    if (block.kind === 'tool' && typeof block.meta?.turnId === 'string' && block.meta.turnId.trim()) {
      return block.meta.turnId.trim()
    }
  }
  return ''
}

function childMetaFromTool(block: ChatBlock): Record<string, unknown> | null {
  if (block.kind !== 'tool') return null
  if (block.activityKind !== 'multi_agent_action' && block.meta?.activityKind !== 'multi_agent_action') return null
  const child = block.meta?.child
  if (child && typeof child === 'object') return child as Record<string, unknown>
  return null
}

function MultiAgentPanel({ blocks }: { blocks: ChatBlock[] }): ReactElement | null {
  const children = blocks
    .map((block) => {
      const child = childMetaFromTool(block)
      if (!child) return null
      const childId = typeof child.childId === 'string' ? child.childId : ''
      if (!childId) return null
      const childStatus = typeof child.childStatus === 'string' ? child.childStatus : block.kind === 'tool' ? block.status : ''
      return {
        childId,
        label: typeof child.childLabel === 'string' && child.childLabel.trim() ? child.childLabel.trim() : childId,
        status: childStatus
      }
    })
    .filter((child): child is { childId: string; label: string; status: string } => child !== null)
  if (children.length === 0) return null
  const working = children.filter((child) => child.status === 'queued' || child.status === 'running').length
  const done = children.filter((child) => child.status === 'completed' || child.status === 'success').length
  return (
    <div className="rounded-md border border-ds-border-muted/70 bg-ds-surface-subtle/55 px-3 py-2 text-[12.5px] text-ds-muted">
      <div className="flex flex-wrap items-center gap-2 font-semibold text-ds-ink">
        <span>Agent panel</span>
        <span className="rounded-full bg-ds-hover px-2 py-0.5 text-[11px] text-ds-muted">{working} working</span>
        <span className="rounded-full bg-ds-hover px-2 py-0.5 text-[11px] text-ds-muted">{done} done</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {children.map((child) => (
          <span key={child.childId} className="rounded-md border border-ds-border-muted/60 px-2 py-1 font-mono text-[11.5px] text-ds-muted">
            {child.label} · {child.childId}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatSpanDuration(span: TraceSpan): string {
  const ms = span.durationMs ?? 0
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function DebugTracePanel({
  spans,
  rawEvents
}: {
  spans?: Record<string, TraceSpan>
  rawEvents?: RawRuntimeEvent[]
}): ReactElement | null {
  const spanList = Object.values(spans ?? {})
  const events = rawEvents ?? []
  if (spanList.length === 0 && events.length === 0) return null
  const sortedSpans = spanList.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return (
    <div className="rounded-md border border-ds-border-muted/70 bg-ds-surface-subtle/60 px-3 py-2 text-[12px] text-ds-muted">
      {sortedSpans.length > 0 ? (
        <div>
          <div className="font-semibold text-ds-ink">Trace tree</div>
          <div className="mt-1 space-y-1">
            {sortedSpans.map((span) => (
              <div key={span.spanId} className="flex min-w-0 items-center gap-2 font-mono">
                <span className="min-w-0 truncate text-ds-ink">{span.name}</span>
                <span className="shrink-0 text-ds-faint">{span.spanKind}</span>
                <span className="shrink-0 text-ds-faint">{span.spanStatus}</span>
                {span.endedAt ? <span className="shrink-0 text-ds-muted">{formatSpanDuration(span)}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className={sortedSpans.length > 0 ? 'mt-3' : ''}>
          <div className="font-semibold text-ds-ink">Raw events</div>
          <div className="mt-1 max-h-40 overflow-hidden font-mono text-[11px] leading-5 text-ds-faint">
            {events.slice(-12).map((event, index) => (
              <div key={`${event.seq ?? index}-${event.kind ?? 'event'}`} className="truncate">
                {String(event.kind ?? 'event')}
                {typeof event.seq === 'number' ? ` #${event.seq}` : ''}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LiveTurnProgressRow({ hasActiveGoal }: { hasActiveGoal: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const swimMode = useWorkLogoSwimMode(true)
  const iqwicksVariant = useIqwicksWorkLogoVariant(true)
  const steeredAt = useChatStore((s) => s.steeredAt)
  // iQWicks 模式是全局 html 属性;进行行每个回合重新挂载,挂载时读取即可
  const [iqwicksModeOn] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-iqwicks-mode') === 'on'
  )
  const swimLabelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
  // UI 插件可声明自己的进行中文案(按泳姿键、按语言),未声明则用默认文案
  const pluginLabel = useUiPluginWorkLabel(
    swimLabelKey as UiPluginLabelKey,
    i18n.language ?? 'zh'
  )
  const label = iqwicksModeOn
    ? t(IQWICKS_WORK_LOGO_VARIANT_LABEL_KEYS[iqwicksVariant])
    : pluginLabel ?? t(swimLabelKey)

  return (
    <div className={liveTurnProgressClass(hasActiveGoal)}>
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active iqwicksVariant={iqwicksVariant} mode={swimMode} phase="trail" size="sm" />
      </span>
      <span className="ds-shiny-text">{label}</span>
      {steeredAt > 0 ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ds-accent-soft/40 px-2 py-0.5 text-[12px] font-medium text-ds-accent">
          <CornerUpLeft className="h-3 w-3" strokeWidth={2} />
          {t('steered')}
        </span>
      ) : null}
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.turnTimer === next.turnTimer &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.compactCards === next.compactCards &&
  prev.conversationDetailLevel === next.conversationDetailLevel &&
  prev.traceSpansByTurnId === next.traceSpansByTurnId &&
  prev.runtimeEventsByTurnId === next.runtimeEventsByTurnId &&
  prev.viewportRef === next.viewportRef &&
  prev.nowMs === next.nowMs
))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  getKunRuntimeSettings,
  mergeAppBehaviorSettings,
  mergeClawSettings,
  mergeKunRuntimeSettings,
  mergeModelProviderSettings,
  mergeScheduleSettings,
  mergeWorkflowSettings,
  mergeWriteSettings,
  normalizeAppSettings,
  normalizeKeyboardShortcuts,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ModelProviderModelGroup
} from '@shared/app-settings'
import type {
  ClawChannelActivityPayload,
  ComputerUsePermissions,
  DesktopCommand,
  KunGuiApi,
  KunRuntimeStatusPayload,
  SseEndPayload,
  SseEventPayload,
  TrayActionPayload,
  TurnCompleteNotificationPayload
} from '@shared/kun-gui-api'
import type { TerminalDataPayload, TerminalExitPayload } from '@shared/terminal'
import type { WorkspaceFileChangePayload } from '@shared/workspace-file'

type TeamflowCodexProvider = {
  id: string
  label: string
  model: string
  baseUrl?: string | null
}

type TeamflowRunStatus = {
  currentRunId?: string
  workspace?: string
  codexState?: string
  codexBridgeState?: {
    workerRunning?: boolean
  }
  codexRoundState?: {
    active?: boolean
  }
  codexModelSelection?: {
    activeProviderId?: string
    activeProvider?: TeamflowCodexProvider
    providers?: TeamflowCodexProvider[]
  }
}

type TeamflowRealtimeEnvelope = {
  seq?: number
  emittedAt?: string
  runId?: string
  sessionId?: string
  agent?: string
  topic?: string
  eventType?: string
  payload?: unknown
}

const off = (): void => undefined

const defaultSettings = normalizeAppSettings({
  version: 1,
  locale: 'zh',
  theme: 'system',
  uiFontScale: 'small',
  cursorSpotlight: true,
  provider: defaultModelProviderSettings(),
  agents: { kun: defaultKunRuntimeSettings() },
  workspaceRoot: '',
  log: { enabled: true, retentionDays: 3 },
  notifications: { turnComplete: true },
  appBehavior: {
    openAtLogin: false,
    startMinimized: false,
    closeAction: 'ask',
    closeToTray: false
  },
  keyboardShortcuts: normalizeKeyboardShortcuts(undefined),
  write: defaultWriteSettings(),
  claw: defaultClawSettings(),
  schedule: defaultScheduleSettings(),
  workflow: defaultWorkflowSettings(),
  guiUpdate: { channel: 'stable' },
  codePromptPrefix: '',
  disabledSkillIds: []
})

const sseStreams = new Map<string, { threadId: string; sinceSeq: number }>()
const sseEventHandlers = new Set<(payload: SseEventPayload) => void>()
const sseEndHandlers = new Set<(payload: SseEndPayload) => void>()
const sseErrorHandlers = new Set<(payload: { streamId: string; status?: number; message?: string }) => void>()
const runtimeStatusHandlers = new Set<(payload: KunRuntimeStatusPayload) => void>()
const guiUpdateHandlers = new Set<(payload: Awaited<ReturnType<KunGuiApi['getGuiUpdateState']>>) => void>()

let settingsCache: AppSettingsV1 | null = null
let realtimeUnlistenPromise: Promise<() => void> | null = null
let pollingTimer: number | null = null
let lastRealtimeSeq = 0

function platformName(): string {
  const value = navigator.platform.toLowerCase()
  if (value.includes('win')) return 'win32'
  if (value.includes('mac')) return 'darwin'
  if (value.includes('linux')) return 'linux'
  return 'unknown'
}

async function invokeMaybe<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    console.warn(`[teamflow-kun] ${command} failed`, error)
    return null
  }
}

function mergeSettings(current: AppSettingsV1, patch: AppSettingsPatch): AppSettingsV1 {
  return normalizeAppSettings({
    ...current,
    ...patch,
    provider: patch.provider ? mergeModelProviderSettings(current.provider, patch.provider) : current.provider,
    agents: patch.agents?.kun
      ? { kun: mergeKunRuntimeSettings(getKunRuntimeSettings(current), patch.agents.kun) }
      : current.agents,
    log: { ...current.log, ...(patch.log ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    appBehavior: patch.appBehavior
      ? mergeAppBehaviorSettings(current.appBehavior, patch.appBehavior)
      : current.appBehavior,
    keyboardShortcuts: patch.keyboardShortcuts
      ? normalizeKeyboardShortcuts({ ...current.keyboardShortcuts, ...patch.keyboardShortcuts })
      : current.keyboardShortcuts,
    write: patch.write ? mergeWriteSettings(current.write, patch.write) : current.write,
    claw: patch.claw ? mergeClawSettings(current.claw, patch.claw) : current.claw,
    schedule: patch.schedule ? mergeScheduleSettings(current.schedule, patch.schedule) : current.schedule,
    workflow: patch.workflow ? mergeWorkflowSettings(current.workflow, patch.workflow) : current.workflow,
    guiUpdate: { ...current.guiUpdate, ...(patch.guiUpdate ?? {}) }
  })
}

function normalizeStoredSettings(raw: unknown): AppSettingsV1 {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const locale =
    source.locale === 'en' || source.locale === 'zh'
      ? source.locale
      : source.language === 'en'
        ? 'en'
        : 'zh'
  return normalizeAppSettings({
    ...defaultSettings,
    ...source,
    locale,
    provider:
      source.provider && typeof source.provider === 'object'
        ? (source.provider as AppSettingsV1['provider'])
        : defaultSettings.provider,
    agents:
      source.agents && typeof source.agents === 'object'
        ? (source.agents as AppSettingsV1['agents'])
        : defaultSettings.agents,
    workspaceRoot: typeof source.workspaceRoot === 'string' ? source.workspaceRoot : defaultSettings.workspaceRoot,
    write: source.write && typeof source.write === 'object' ? (source.write as AppSettingsV1['write']) : defaultSettings.write,
    claw: source.claw && typeof source.claw === 'object' ? (source.claw as AppSettingsV1['claw']) : defaultSettings.claw,
    schedule:
      source.schedule && typeof source.schedule === 'object'
        ? (source.schedule as AppSettingsV1['schedule'])
        : defaultSettings.schedule,
    workflow:
      source.workflow && typeof source.workflow === 'object'
        ? (source.workflow as AppSettingsV1['workflow'])
        : defaultSettings.workflow
  } as AppSettingsV1)
}

async function readSettings(): Promise<AppSettingsV1> {
  if (settingsCache) return settingsCache
  const raw = await invokeMaybe<unknown>('get_ui_settings')
  let settings = normalizeStoredSettings(raw)
  const status = await invokeMaybe<TeamflowRunStatus>('get_status')
  if (status?.workspace && !settings.workspaceRoot) {
    settings = normalizeAppSettings({ ...settings, workspaceRoot: status.workspace })
  }
  const provider = status?.codexModelSelection?.activeProvider
  if (provider?.model) {
    settings = mergeSettings(settings, {
      agents: {
        kun: {
          providerId: provider.id || DEFAULT_MODEL_PROVIDER_ID,
          model: provider.model,
          baseUrl: provider.baseUrl ?? settings.agents.kun.baseUrl
        }
      }
    })
  }
  settingsCache = settings
  return settings
}

async function saveSettings(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const saved = await invokeMaybe<unknown>('set_ui_settings', { settings })
  settingsCache = normalizeStoredSettings(saved ?? settings)
  return settingsCache
}

function addHandler<T>(set: Set<(payload: T) => void>, handler: (payload: T) => void): () => void {
  set.add(handler)
  return () => {
    set.delete(handler)
  }
}

function runtimeStatusFromTeamflow(status: TeamflowRunStatus): KunRuntimeStatusPayload {
  const running =
    status.codexRoundState?.active === true ||
    status.codexBridgeState?.workerRunning === true ||
    status.codexState === 'RUNNING'
  return {
    state: running ? 'running' : 'stopped',
    source: 'teamflow',
    message: running ? 'Teamflow 后端正在处理。' : 'Teamflow 后端已就绪。',
    at: new Date().toISOString()
  }
}

function emitRuntimeStatus(status: TeamflowRunStatus): void {
  const payload = runtimeStatusFromTeamflow(status)
  for (const handler of runtimeStatusHandlers) handler(payload)
}

function streamIdsForRun(runId: string | undefined): string[] {
  const ids: string[] = []
  for (const [streamId, stream] of sseStreams) {
    if (!runId || !stream.threadId || stream.threadId === runId) ids.push(streamId)
  }
  return ids
}

function dispatchRealtime(envelope: TeamflowRealtimeEnvelope): void {
  const seq = typeof envelope.seq === 'number' ? envelope.seq : 0
  if (seq > lastRealtimeSeq) lastRealtimeSeq = seq
  for (const streamId of streamIdsForRun(envelope.runId)) {
    const stream = sseStreams.get(streamId)
    if (!stream || seq <= stream.sinceSeq) continue
    for (const handler of sseEventHandlers) handler({ streamId, events: [envelope] })
  }
  if (envelope.topic === 'status' && envelope.payload && typeof envelope.payload === 'object') {
    emitRuntimeStatus(envelope.payload as TeamflowRunStatus)
  }
}

async function ensureRealtimeBridge(): Promise<void> {
  if (!realtimeUnlistenPromise) {
    realtimeUnlistenPromise = listen<TeamflowRealtimeEnvelope>('teamflow_realtime', (event) => {
      dispatchRealtime(event.payload)
    })
  }
  await realtimeUnlistenPromise
  if (pollingTimer !== null) return
  pollingTimer = window.setInterval(() => {
    if (sseStreams.size === 0) return
    void invokeMaybe<{ events?: TeamflowRealtimeEnvelope[]; latestSeq?: number }>('get_realtime_events', {
      fromSeq: lastRealtimeSeq
    }).then((result) => {
      if (!result) return
      for (const event of result.events ?? []) dispatchRealtime(event)
      if (typeof result.latestSeq === 'number') lastRealtimeSeq = Math.max(lastRealtimeSeq, result.latestSeq)
    })
  }, 1200)
}

async function readModelGroups(): Promise<{
  modelIds: string[]
  defaultModelId: string
  modelGroups: ModelProviderModelGroup[]
}> {
  const status = await invokeMaybe<TeamflowRunStatus>('get_status')
  const settings = await readSettings()
  const runtime = getKunRuntimeSettings(settings)
  const providers = status?.codexModelSelection?.providers ?? []
  const defaultProvider = status?.codexModelSelection?.activeProvider ?? providers[0]
  const modelIds = [...new Set(providers.map((provider) => provider.model).filter(Boolean))]
  return {
    modelIds: modelIds.length ? modelIds : [runtime.model],
    defaultModelId: defaultProvider?.model ?? runtime.model,
    modelGroups: providers.map((provider) => ({
      providerId: provider.id,
      label: provider.label || provider.id,
      modelIds: [provider.model],
      modelProfiles: {
        [provider.model]: {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          reasoning: {
            supportedEfforts: ['auto', 'off', 'low', 'medium', 'high', 'max'],
            defaultEffort: 'auto',
            requestProtocol: 'openai-responses'
          }
        }
      }
    }))
  }
}

function unsupported(message = 'Teamflow 当前后端未启用此 Kun 桌面能力。'): { ok: false; message: string } {
  return { ok: false, message }
}

async function runNativeDesktopCommand(command: DesktopCommand): Promise<void> {
  if (command === 'reload') {
    window.location.reload()
    return
  }
  if (
    command === 'minimize' ||
    command === 'toggleMaximize' ||
    command === 'close' ||
    command === 'quit'
  ) {
    await invokeMaybe<void>('run_desktop_command', { command })
  }
}

function createApi(): KunGuiApi {
  const api = {
    platform: platformName(),
    homeDir: '',
    getSettings: readSettings,
    setSettings: async (partial) => saveSettings(mergeSettings(await readSettings(), partial)),
    saveSettingsSilent: async (partial) => {
      const next = mergeSettings(await readSettings(), partial)
      settingsCache = next
      void saveSettings(next)
      const providerId = partial.agents?.kun?.providerId?.trim()
      if (providerId) void invokeMaybe('set_codex_model_provider', { providerId })
      return next
    },
    runtimeRequest: async () => ({ ok: false, status: 404, body: '{"message":"Teamflow uses native commands."}' }),
    restartRuntime: async () => undefined,
    fetchUpstreamModels: async () => ({ ok: true, ...(await readModelGroups()) }),
    probeModelProvider: async () => unsupported(),
    getClawStatus: async () => ({ imServerRunning: false, imUrl: '', runningTaskIds: [] }),
    runClawTask: async () => unsupported(),
    getScheduleStatus: async () => ({
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      powerSaveBlockerActive: false
    }),
    runScheduleTask: async () => unsupported(),
    getWorkflowStatus: async () => ({
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }),
    runWorkflow: async () => unsupported(),
    stopWorkflow: async () => unsupported(),
    runWorkflowNode: async () => unsupported(),
    testWorkflowNode: async () => unsupported(),
    resolveWorkflowApproval: async () => ({ ok: false }),
    checkWorkflowCode: async () => ({ status: 'unavailable', message: 'Teamflow 当前后端未启用工作流代码检查。' }),
    startClawImInstallQr: async () => unsupported(),
    pollClawImInstall: async () => ({ done: false, error: 'unsupported' }),
    connectTelegramBot: async () => ({ ok: false, code: 'unknown', message: 'unsupported' }),
    pickWorkspaceDirectory: async () => ({ canceled: true, path: null }),
    confirmDialog: async (options) => window.confirm(options.detail ? `${options.message}\n\n${options.detail}` : options.message),
    detectLegacySessions: async () => ({ destDir: '', sources: [] }),
    importLegacySessions: async () => ({ ok: false, message: 'unsupported' }),
    pickLegacySessionDir: async () => ({ canceled: true, path: null }),
    listSkills: async () => ({ ok: true, skills: [], validationErrors: [] }),
    listSkillRoots: async () => ({ ok: true, roots: [] }),
    saveSkillFile: async () => unsupported(),
    openSkillRoot: async () => unsupported(),
    listUiPlugins: async () => ({ plugins: [] }),
    installUiPlugin: async () => ({ canceled: true }),
    removeUiPlugin: async () => ({ ok: false }),
    loadUiPlugin: async () => ({ ok: false, error: 'unsupported' }),
    getKunConfigFile: async () => ({ path: '', content: '{}', exists: false }),
    setKunConfigFile: async () => ({ ok: true, path: '' }),
    openKunConfigDir: async () => unsupported(),
    getGitBranches: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Git。' }),
    switchGitBranch: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Git。' }),
    createAndSwitchGitBranch: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Git。' }),
    createGitCheckpoint: async () => unsupported(),
    restoreGitCheckpoint: async () => unsupported(),
    checkoutGitBranchWorktree: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Worktree。' }),
    createGitBranchWorktree: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Worktree。' }),
    listGitBranchWorktrees: async () => ({ ok: false, reason: 'git_unavailable', message: 'Teamflow 当前后端未启用 Worktree。' }),
    removeGitBranchWorktree: async () => undefined,
    acquireWorktree: async () => Promise.reject(new Error('unsupported')),
    releaseWorktree: async () => undefined,
    listWorktrees: async (params) => ({
      projectPath: params.projectPath,
      poolDir: '',
      mainBranch: '',
      headCommit: '',
      worktrees: [],
      inUseCount: 0,
      isGitRepo: false
    }),
    removeWorktree: async () => undefined,
    getWorktreeChanges: async (params) => ({
      worktreePath: params.worktreePath,
      baseCommit: '',
      currentCommit: '',
      modifiedFiles: [],
      addedFiles: [],
      deletedFiles: [],
      hasUncommittedChanges: false
    }),
    commitWorktree: async () => '',
    mergeWorktree: async () => ({ success: false, mergedCommit: null, hasConflicts: false, conflictedFiles: [], message: 'unsupported' }),
    abortWorktreeMerge: async () => undefined,
    continueWorktreeMerge: async () => ({ success: false, mergedCommit: null, hasConflicts: false, conflictedFiles: [], message: 'unsupported' }),
    syncWorktreeFromMain: async () => ({ success: false, syncedCommit: null, hasConflicts: false, conflictedFiles: [], message: 'unsupported' }),
    abortWorktreeRebase: async () => undefined,
    cleanupWorktrees: async () => undefined,
    findAvailableWorktreePoolIndex: async () => null,
    listEditors: async () => ({ editors: [], defaultEditorId: '' }),
    openEditorPath: async () => unsupported(),
    listWorkspaceDirectory: async () => unsupported(),
    resolveWorkspaceFile: async () => unsupported(),
    readWorkspaceFile: async () => unsupported(),
    readWorkspaceImage: async () => unsupported(),
    readWorkspacePdf: async () => unsupported(),
    saveWorkspaceFileAs: async () => unsupported(),
    writeWorkspaceFile: async () => unsupported(),
    createWorkspaceFile: async () => unsupported(),
    createWorkspaceDirectory: async () => unsupported(),
    saveWorkspaceClipboardImage: async () => unsupported(),
    readClipboardImage: async () => unsupported(),
    getPathForFile: () => '',
    renameWorkspaceEntry: async () => unsupported(),
    deleteWorkspaceEntry: async () => unsupported(),
    watchWorkspaceFile: async () => unsupported(),
    unwatchWorkspaceFile: async () => false,
    onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => {
      void handler
      return off
    },
    requestWriteInlineCompletion: async () => unsupported(),
    retrieveWriteContext: async () => unsupported(),
    generateWriteInfographic: async () => unsupported(),
    authorizeWritePrototype: async () => unsupported(),
    openWritePrototype: async () => unsupported(),
    transcribeSpeech: async () => unsupported(),
    listWriteInlineCompletionDebugEntries: async () => [],
    clearWriteInlineCompletionDebugEntries: async () => true,
    exportWriteDocument: async () => unsupported(),
    copyWriteDocumentAsRichText: async () => unsupported(),
    startSse: async (threadId, sinceSeq, streamId = `teamflow-${crypto.randomUUID()}`) => {
      sseStreams.set(streamId, { threadId, sinceSeq })
      await ensureRealtimeBridge()
      const replay = await invokeMaybe<{ events?: TeamflowRealtimeEnvelope[] }>('get_realtime_events', {
        fromSeq: sinceSeq,
        runId: threadId
      })
      for (const event of replay?.events ?? []) dispatchRealtime(event)
      return { streamId }
    },
    stopSse: async (streamId) => sseStreams.delete(streamId),
    onSseEvent: (handler) => addHandler(sseEventHandlers, handler),
    onSseEnd: (handler) => addHandler(sseEndHandlers, handler),
    onSseError: (handler) => addHandler(sseErrorHandlers, handler),
    onClawChannelActivity: (handler: (payload: ClawChannelActivityPayload) => void) => {
      void handler
      return off
    },
    onTrayAction: (handler: (payload: TrayActionPayload) => void) => {
      void handler
      return off
    },
    onRuntimeStatus: (handler) => addHandler(runtimeStatusHandlers, handler),
    mirrorClawChannelMessage: async () => ({ ok: false, message: 'unsupported' }),
    mirrorClawChannelMessageToFeishu: async () => ({ ok: false, message: 'unsupported' }),
    createClawTaskFromText: async () => ({ kind: 'error', message: 'unsupported' }),
    createScheduleTaskFromText: async () => ({ kind: 'error', message: 'unsupported' }),
    runDesktopCommand: runNativeDesktopCommand,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    getComputerUsePermissions: async (): Promise<ComputerUsePermissions> => ({
      platform: platformName(),
      supported: false,
      needsPermission: false,
      accessibility: 'unknown',
      screenRecording: 'unknown',
      accessibilityNeedsRestart: false
    }),
    requestComputerUsePermission: async () => api.getComputerUsePermissions(),
    showTurnCompleteNotification: async (payload: TurnCompleteNotificationPayload) => {
      if (!('Notification' in window)) return { ok: true, shown: false, reason: 'unsupported' }
      if (Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined)
      if (Notification.permission !== 'granted') return { ok: true, shown: false, reason: 'denied' }
      new Notification(payload.title, { body: payload.body })
      return { ok: true, shown: true }
    },
    getAppVersion: async () => '0.1.0',
    getGuiUpdateState: async () => ({ status: 'idle' }),
    checkGuiUpdate: async () => ({ ok: false, currentVersion: '0.1.0', message: 'unsupported', code: 'unsupported' }),
    downloadGuiUpdate: async () => ({ ok: false, currentVersion: '0.1.0', message: 'unsupported', code: 'unsupported' }),
    installGuiUpdate: async () => ({ ok: false, currentVersion: '0.1.0', message: 'unsupported', code: 'unsupported' }),
    onGuiUpdateState: (handler) => addHandler(guiUpdateHandlers, handler),
    logError: async (category, message, detail) => {
      console.error(`[${category}] ${message}`, detail)
    },
    getLogPath: async () => '',
    openLogDir: async () => unsupported(),
    createTerminal: async () => unsupported(),
    writeToTerminal: async () => false,
    resizeTerminal: async () => false,
    disposeTerminal: async () => false,
    onTerminalData: (handler: (payload: TerminalDataPayload) => void) => {
      void handler
      return off
    },
    onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => {
      void handler
      return off
    }
  } satisfies KunGuiApi
  return api
}

if (!window.kunGui) {
  window.kunGui = createApi()
}

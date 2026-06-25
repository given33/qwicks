import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type {
  ApprovalPolicy,
  AppSettingsV1,
  ModelProviderProfileV1,
  SandboxMode
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_QWICKS_DATA_DIR,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  defaultModelProviderSettings,
  isQWicksRuntimeInsecure,
  CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
  IMAGE_GENERATION_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  MUSIC_GENERATION_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissions,
  ComputerUsePermissionState,
  SkillConfigField,
  SkillListItem,
  SkillRootListItem
} from '@shared/qwicks-gui-api'
import { Ban, FolderOpen, Loader2, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  ModelSelect,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { formatCompactNumber } from '../hooks/use-thread-usage'
import { parseUsageResponse } from '../hooks/usage-response'

export { modelProvidersSettingsPatch } from './settings-section-providers'

function statusPill(status: string | undefined): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'disabled') return 'border-ds-border-muted bg-ds-card text-ds-faint'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

function skillRootShortLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}

function compactList(values: unknown, empty: string): string {
  if (!Array.isArray(values) || values.length === 0) return empty
  return values
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .slice(0, 4)
    .join(', ')
}

type TokenEconomySavingsSummary = {
  tokens: number
}

type TokenEconomySavingsState = {
  loading: boolean
  loaded: boolean
  summary: TokenEconomySavingsSummary | null
}

const EMPTY_TOKEN_ECONOMY_SAVINGS_STATE: TokenEconomySavingsState = {
  loading: false,
  loaded: false,
  summary: null
}

type ModelContextProfileSummary = {
  modelLabel: string
  contextWindowLabel: string
  softThresholdLabel: string
  hardThresholdLabel: string
  sourceLabelKey: string
}

const DEEPSEEK_V4_CONTEXT_PROFILE = {
  contextWindowTokens: 1_000_000,
  softThreshold: 980_000,
  hardThreshold: 990_000
}

function formatTokenNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function normalizeModelId(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase() ?? ''
  return normalized === 'auto' ? '' : normalized
}

function knownModelContextProfile(input: string | undefined): { modelLabel: string } | null {
  const normalized = normalizeModelId(input)
  if (!normalized) return null
  const match = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']
    .find((modelId) => normalized === modelId || normalized.endsWith(`/${modelId}`))
  return match ? { modelLabel: match } : null
}

function modelContextProfileSummary(input: {
  model: string | undefined
  fallbackSoftThreshold: number
  fallbackHardThreshold: number
}): ModelContextProfileSummary {
  const known = knownModelContextProfile(input.model)
  if (known) {
    return {
      modelLabel: known.modelLabel,
      contextWindowLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.contextWindowTokens),
      softThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.softThreshold),
      hardThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.hardThreshold),
      sourceLabelKey: 'qwicksModelContextSourceBuiltIn'
    }
  }
  const model = input.model?.trim() || 'auto'
  return {
    modelLabel: model,
    contextWindowLabel: 'models.profiles',
    softThresholdLabel: formatTokenNumber(input.fallbackSoftThreshold),
    hardThresholdLabel: formatTokenNumber(input.fallbackHardThreshold),
    sourceLabelKey: 'qwicksModelContextSourceFallback'
  }
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function loadTokenEconomySavingsSummary(): Promise<TokenEconomySavingsSummary | null> {
  if (typeof window === 'undefined' || typeof window.qwicksGui?.runtimeRequest !== 'function') return null
  const response = await window.qwicksGui.runtimeRequest('/v1/usage?group_by=thread', 'GET')
  if (!response.ok || !response.body.trim()) return null
  const parsed = parseUsageResponse<{ totals?: Record<string, unknown> }>(response.body, 'token economy usage')
  const totals = parsed.totals ?? {}
  const tokens = usageNumber(totals.token_economy_savings_tokens)
  if (tokens <= 0) return null
  return { tokens }
}

export function AgentsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    qwicks,
    update,
    updateQWicks,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    compactHomePathList,
    expandHomePathList,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    skillRoots,
    skillRootsLoading,
    builtinSkills = [],
    toggleSkillRoot,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshQWicksDiagnostics,
    disableMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const mcpSearch = qwicks.mcpSearch ?? {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
  const tokenEconomyDefaults = {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: {
      maxToolResultLines: 320,
      maxToolResultBytes: 32768,
      maxToolResultTokens: 8000,
      maxToolArgumentStringBytes: 8192,
      maxToolArgumentStringTokens: 2000,
      maxArrayItems: 80
    }
  }
  const tokenEconomy = {
    ...tokenEconomyDefaults,
    ...(qwicks.tokenEconomy ?? {}),
    enabled: qwicks.tokenEconomy?.enabled ?? qwicks.tokenEconomyMode ?? false,
    historyHygiene: {
      ...tokenEconomyDefaults.historyHygiene,
      ...(qwicks.tokenEconomy?.historyHygiene ?? {})
    }
  }
  const [tokenEconomySavingsState, setTokenEconomySavingsState] =
    useState<TokenEconomySavingsState>(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
  useEffect(() => {
    let cancelled = false
    if (!tokenEconomy.enabled) {
      setTokenEconomySavingsState(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
      return
    }
    setTokenEconomySavingsState((current) => ({ ...current, loading: true }))
    void loadTokenEconomySavingsSummary()
      .then((summary) => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary })
      })
      .catch(() => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary: null })
      })
    return () => {
      cancelled = true
    }
  }, [tokenEconomy.enabled])
  const tokenEconomySavings = tokenEconomySavingsState.summary
  const storage = qwicks.storage ?? {
    backend: 'hybrid',
    sqlitePath: ''
  }
  const contextCompaction = qwicks.contextCompaction ?? {
    defaultSoftThreshold: 16000,
    defaultHardThreshold: 24000,
    summaryMode: 'model',
    summaryTimeoutMs: 15000,
    summaryMaxTokens: 1200,
    summaryInputMaxBytes: 98304
  }
  const modelContext = modelContextProfileSummary({
    model: qwicks.model,
    fallbackSoftThreshold: contextCompaction.defaultSoftThreshold,
    fallbackHardThreshold: contextCompaction.defaultHardThreshold
  })
  const runtimeTuning = qwicks.runtimeTuning ?? {
    streamIdleTimeoutMs: 45000,
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 524288
    }
  }
  const updateMcpSearch = (patch: Record<string, unknown>): void => {
    updateQWicks({
      mcpSearch: {
        ...mcpSearch,
        ...patch
      }
    })
  }
  const updateTokenEconomy = (patch: Record<string, unknown>): void => {
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : tokenEconomy.enabled
    updateQWicks({
      tokenEconomyMode: enabled,
      tokenEconomy: {
        ...tokenEconomy,
        ...patch,
        enabled
      }
    })
  }
  const updateHistoryHygiene = (patch: Record<string, unknown>): void => {
    updateTokenEconomy({
      historyHygiene: {
        ...tokenEconomy.historyHygiene,
        ...patch
      }
    })
  }
  const updateStorage = (patch: Record<string, unknown>): void => {
    updateQWicks({
      storage: {
        ...storage,
        ...patch
      }
    })
  }
  const updateContextCompaction = (patch: Record<string, unknown>): void => {
    updateQWicks({
      contextCompaction: {
        ...contextCompaction,
        ...patch
      }
    })
  }
  const updateRuntimeTuning = (patch: Record<string, unknown>): void => {
    updateQWicks({
      runtimeTuning: {
        ...runtimeTuning,
        ...patch
      }
    })
  }
  const updateToolStorm = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolStorm: {
        ...runtimeTuning.toolStorm,
        ...patch
      }
    })
  }
  const updateToolArgumentRepair = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolArgumentRepair: {
        ...runtimeTuning.toolArgumentRepair,
        ...patch
      }
    })
  }
  const provider = form.provider ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const computerUse = qwicks.computerUse ?? {
    enabled: false,
    mode: 'auto' as const,
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
  const updateComputerUse = (patch: Record<string, unknown>): void => {
    updateQWicks({
      computerUse: {
        ...computerUse,
        ...patch
      }
    })
  }
  const quality = qwicks.quality ?? {
    enabled: true,
    strictness: 'standard' as const,
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
  const updateQuality = (patch: Record<string, unknown>): void => {
    updateQWicks({
      quality: {
        ...quality,
        ...patch
      }
    })
  }
  const activeProviderId = qwicks.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const activeProvider = modelProviders.find((item) => item.id === activeProviderId) ?? modelProviders[0]
  const activeProviderModels = activeProvider?.models ?? []
  const selectQWicksProvider = (providerId: string): void => {
    const nextProvider = modelProviders.find((item) => item.id === providerId) ?? activeProvider
    const nextModel = nextProvider?.models.includes(qwicks.model)
      ? qwicks.model
      : nextProvider?.models[0] ?? qwicks.model
    updateQWicks({ providerId, model: nextModel, apiKey: '', baseUrl: '' })
  }

  return (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                <SectionJumpButton label={t('agentsQuickBase')} onClick={() => scrollToAgentSection('agents')} />
                <SectionJumpButton label={t('agentsQuickSkill')} onClick={() => scrollToAgentSection('skill')} />
                <SectionJumpButton label={t('agentsQuickMcp')} onClick={() => scrollToAgentSection('mcp')} />
                <SectionJumpButton
                  label={t('agentsQuickPermissions')}
                  onClick={() => scrollToAgentSection('permissions')}
                />
              </div>

              <div ref={agentsSectionRef}>
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={qwicks.autoStart}
                        onChange={(v) => updateQWicks({ autoStart: v })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksProvider')}
                    description={t('qwicksProviderSelectDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={activeProvider?.id ?? DEFAULT_MODEL_PROVIDER_ID}
                        onChange={(e) => selectQWicksProvider(e.target.value)}
                      >
                        {modelProviders.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('qwicksModel')}
                    description={t('qwicksModelDesc')}
                    control={
                      <ModelSelect
                        value={qwicks.model}
                        options={activeProviderModels}
                        optionLabel={(model) =>
                          model === activeProviderModels[0]
                            ? t('modelSelectDefaultSuffix', { model })
                            : model}
                        allowCustom
                        customLabel={t('modelSelectCustomOption')}
                        customPlaceholder={t('modelSelectCustomPlaceholder')}
                        selectClassName={selectControlClass}
                        onChange={(model) => {
                          const next = model.trim()
                          updateQWicks({ model: next || (activeProviderModels[0] ?? qwicks.model) })
                        }}
                      />
                    }
                  />
                  <SettingRow
                    title={t('codePromptPrefix')}
                    description={t('codePromptPrefixDesc')}
                    wideControl
                    control={
                      <textarea
                        value={form?.codePromptPrefix ?? ''}
                        onChange={(e) => update({ codePromptPrefix: e.target.value })}
                        placeholder={t('codePromptPrefixPlaceholder')}
                        className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('qwicksAssistantAdvanced')}
                      description={t('qwicksAssistantAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={qwicks.port}
                          onChange={(e) => updateQWicks({ port: Number(e.target.value) })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksBinary')}
                    description={t('qwicksBinaryDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('qwicksBinaryPlaceholder')}
                        value={compactHomePath(qwicks.binaryPath)}
                        onChange={(e) => updateQWicks({ binaryPath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksDataDir')}
                    description={t('qwicksDataDirDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={DEFAULT_QWICKS_DATA_DIR}
                        value={compactHomePath(qwicks.dataDir)}
                        onChange={(e) => updateQWicks({ dataDir: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={qwicks.runtimeToken}
                        onChange={(value) => updateQWicks({ runtimeToken: value })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksInsecure')}
                    description={
                      qwicks.runtimeToken.trim()
                        ? t('qwicksInsecureDesc')
                        : t('qwicksInsecureForcedDesc')
                    }
                    control={
                      <Toggle
                        checked={isQWicksRuntimeInsecure(qwicks)}
                        disabled={!qwicks.runtimeToken.trim()}
                        onChange={(v) => updateQWicks({ insecure: v })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                  <SettingRow
                    title={t('qwicksTokenEconomy')}
                    description={t('qwicksTokenEconomyDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={tokenEconomy.enabled}
                          onChange={(enabled) => updateTokenEconomy({ enabled })}
                        />
                        {tokenEconomy.enabled ? (
                          <div className="max-w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium leading-5 text-emerald-700 dark:text-emerald-200">
                            {tokenEconomySavings ? (
                              <span>
                                {t('qwicksTokenEconomySavings', {
                                  tokens: formatCompactNumber(tokenEconomySavings.tokens)
                                })}
                              </span>
                            ) : tokenEconomySavingsState.loading ? (
                              <span>{t('qwicksTokenEconomySavingsLoading')}</span>
                            ) : (
                              <span>{t('qwicksTokenEconomySavingsEmpty')}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div className="mt-6" ref={permissionsSectionRef}>
                <SettingsCard title={t('permissions')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('permissionsBehaviorHint') }} />
                  </div>
                  <SettingRow
                    title={t('approvalPolicy')}
                    description={t('approvalPolicyDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={qwicks.approvalPolicy}
                        onChange={(e) => updateQWicks({ approvalPolicy: e.target.value as ApprovalPolicy })}
                      >
                        <option value="auto">{t('approvalAuto')}</option>
                        <option value="on-request">{t('approvalOnRequest')}</option>
                        <option value="untrusted">{t('approvalUntrusted')}</option>
                        <option value="suggest">{t('approvalSuggest')}</option>
                        <option value="never">{t('approvalNever')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('sandboxMode')}
                    description={t('sandboxModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={qwicks.sandboxMode}
                        onChange={(e) => updateQWicks({ sandboxMode: e.target.value as SandboxMode })}
                      >
                        <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
                        <option value="read-only">{t('sandboxReadOnly')}</option>
                        <option value="danger-full-access">{t('sandboxFullAccess')}</option>
                        <option value="external-sandbox">{t('sandboxExternal')}</option>
                      </select>
                    }
                  />
                </SettingsCard>
              </div>


              <div className="mt-6">
                <SettingsCard title={t('computerUseTitle')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('computerUseHint') }} />
                  </div>
                  <div className="px-3 pb-4">
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                      <div className="font-semibold">{t('computerUseModelQualityTitle')}</div>
                      <div className="mt-1">{t('computerUseModelQualityBody')}</div>
                    </div>
                  </div>
                  <SettingRow
                    title={t('computerUseEnable')}
                    description={t('computerUseEnableDesc')}
                    control={
                      <Toggle
                        checked={computerUse.enabled}
                        onChange={(enabled) => updateComputerUse({ enabled })}
                      />
                    }
                  />
                  {computerUse.enabled ? (
                    <>
                      <SettingRow
                        title={t('computerUseMode')}
                        description={t('computerUseModeDesc')}
                        control={
                          <select
                            className={selectControlClass}
                            value={computerUse.mode}
                            onChange={(e) => updateComputerUse({ mode: e.target.value })}
                          >
                            <option value="auto">{t('computerUseModeAuto')}</option>
                            <option value="always">{t('computerUseModeAlways')}</option>
                            <option value="off">{t('computerUseModeOff')}</option>
                          </select>
                        }
                      />
                      <ComputerUsePermissionRow t={t} />
                    </>
                  ) : null}
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('designQualityTitle')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('designQualityHint') }} />
                  </div>
                  <SettingRow
                    title={t('designQualityEnable')}
                    description={t('designQualityEnableDesc')}
                    control={
                      <Toggle
                        checked={quality.enabled}
                        onChange={(enabled) => updateQuality({ enabled })}
                      />
                    }
                  />
                  {quality.enabled ? (
                    <SettingRow
                      title={t('designQualityStrictness')}
                      description={t('designQualityStrictnessDesc')}
                      control={
                        <select
                          className={selectControlClass}
                          value={quality.strictness}
                          onChange={(e) => updateQuality({ strictness: e.target.value })}
                        >
                          <option value="relaxed">{t('designQualityStrictnessRelaxed')}</option>
                          <option value="standard">{t('designQualityStrictnessStandard')}</option>
                          <option value="strict">{t('designQualityStrictnessStrict')}</option>
                        </select>
                      }
                    />
                  ) : null}
                </SettingsCard>
              </div>

              <div ref={skillSectionRef} className="mt-6">
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsDetectedDirs')}
                    description={t('skillsDetectedDirsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        {skillRootsLoading && skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('loading')}
                          </div>
                        ) : skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('skillsDetectedDirsEmpty')}
                          </div>
                        ) : (
                          skillRoots.map((root: SkillRootListItem) => (
                            <div
                              key={`${root.id}:${root.path}`}
                              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 shadow-sm ${
                                root.enabled ? 'border-ds-border bg-ds-card' : 'border-ds-border-muted bg-ds-main/40'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[13px] font-medium text-ds-ink">
                                    {root.labelKey ? tCommon(root.labelKey) : skillRootShortLabel(root.path)}
                                  </span>
                                  <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-muted">
                                    {root.scope === 'project' ? t('skillsScopeProject') : t('skillsScopeGlobal')}
                                  </span>
                                  {root.exists ? (
                                    <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                                      {t('skillsDirSkillCount', { count: root.skillCount })}
                                    </span>
                                  ) : (
                                    <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint">
                                      {t('skillsDirNotFound')}
                                    </span>
                                  )}
                                </div>
                                <code className="mt-1 block break-all font-mono text-[12px] text-ds-muted">
                                  {compactHomePath(root.path)}
                                </code>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => void openSkillRoot(root.path)}
                                  className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                  aria-label={t('skillsOpenRoot')}
                                  title={t('skillsOpenRoot')}
                                >
                                  <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                                <Toggle checked={root.enabled} onChange={(value) => toggleSkillRoot(root, value)} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={compactHomePathList(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: expandHomePathList(splitSettingsList(event.target.value))
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={'~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                  {builtinSkills.length > 0 ? (
                    <SettingRow
                      title={t('builtinSkillConfig')}
                      description={t('builtinSkillConfigDesc')}
                      wideControl
                      control={
                        <div className="flex w-full flex-col gap-3">
                          {builtinSkills.map((skill: SkillListItem) => (
                            <BuiltinSkillConfigCard
                              key={skill.id}
                              skill={skill}
                              qwicks={qwicks}
                              providers={modelProviders}
                              t={t}
                              updateQWicks={updateQWicks}
                            />
                          ))}
                        </div>
                      }
                    />
                  ) : null}
                </SettingsCard>
              </div>

              <div ref={mcpSectionRef} className="mt-6">
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('mcpSearchEnabled')}
                    description={t('mcpSearchEnabledDesc')}
                    control={
                      <Toggle
                        checked={mcpSearch.enabled}
                        onChange={(v) => updateMcpSearch({ enabled: v })}
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('mcpAdvanced')}
                      description={t('mcpAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('mcpSearchMode')}
                    description={t('mcpSearchModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={mcpSearch.mode}
                        disabled={!mcpSearch.enabled}
                        onChange={(e) => updateMcpSearch({ mode: e.target.value })}
                      >
                        <option value="auto">{t('mcpSearchModeAuto')}</option>
                        <option value="search">{t('mcpSearchModeSearch')}</option>
                        <option value="direct">{t('mcpSearchModeDirect')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchLimits')}
                    description={t('mcpSearchLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchAutoThreshold')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.autoThresholdToolCount}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ autoThresholdToolCount: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKDefault')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKDefault}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKDefault: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKMax')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKMax}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKMax: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchMinScore')}
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.minScore}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ minScore: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchDiagnostics')}
                    description={t('mcpSearchDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchStatus')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.active ? t('mcpSearchActive') : t('mcpSearchInactive')}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchIndexed')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.indexedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.indexedToolCount ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchAdvertised')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.advertisedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.advertisedToolCount ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {compactHomePath(mcpConfigPath)}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <textarea
                          value={mcpConfigText}
                          onChange={(e) => setMcpConfigText(e.target.value)}
                          spellCheck={false}
                          placeholder={mcpLoading ? t('loading') : ''}
                          className="min-h-[320px] w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>


              <div className="mt-6">
                <SettingsCard title={t('qwicksAdvanced')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('qwicksAdvancedDetails')}
                      description={t('qwicksAdvancedDetailsDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('qwicksTokenEconomyOptions')}
                    description={t('qwicksTokenEconomyOptionsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('qwicksCompressToolDescriptions')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolDescriptions}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolDescriptions) =>
                              updateTokenEconomy({ compressToolDescriptions })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('qwicksCompressToolResults')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolResults}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolResults) =>
                              updateTokenEconomy({ compressToolResults })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('qwicksConciseResponses')}</span>
                          <Toggle
                            checked={tokenEconomy.conciseResponses}
                            disabled={!tokenEconomy.enabled}
                            onChange={(conciseResponses) =>
                              updateTokenEconomy({ conciseResponses })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksHistoryHygiene')}
                    description={t('qwicksHistoryHygieneDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxResultLines')}
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultLines}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultLines: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxResultBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultBytes}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxResultTokens')}
                          <input
                            type="number"
                            min={128}
                            max={256000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultTokens}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxArgumentBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringBytes}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxArgumentTokens')}
                          <input
                            type="number"
                            min={128}
                            max={64000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringTokens}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksHistoryMaxArrayItems')}
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxArrayItems}
                            onChange={(e) => updateHistoryHygiene({ maxArrayItems: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksModelContextProfile')}
                    description={t('qwicksModelContextProfileDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('qwicksModelContextModel')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.modelLabel}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-ds-muted">
                            {t(modelContext.sourceLabelKey)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('qwicksModelContextWindow')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.contextWindowLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('qwicksModelContextSoft')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.softThresholdLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('qwicksModelContextHard')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.hardThresholdLabel}
                          </div>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksStorageBackend')}
                    description={t('qwicksStorageBackendDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={storage.backend}
                        onChange={(e) => updateStorage({ backend: e.target.value })}
                      >
                        <option value="hybrid">{t('qwicksStorageHybrid')}</option>
                        <option value="file">{t('qwicksStorageFile')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('qwicksStorageSqlitePath')}
                    description={t('qwicksStorageSqlitePathDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={compactHomePath(storage.sqlitePath)}
                        disabled={storage.backend !== 'hybrid'}
                        placeholder={t('qwicksStorageSqlitePathPlaceholder')}
                        onChange={(e) => updateStorage({ sqlitePath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksCompactionThresholds')}
                    description={t('qwicksCompactionThresholdsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionSoftThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultSoftThreshold}
                            onChange={(e) => updateContextCompaction({ defaultSoftThreshold: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionHardThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultHardThreshold}
                            onChange={(e) => updateContextCompaction({ defaultHardThreshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksCompactionSummary')}
                    description={t('qwicksCompactionSummaryDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionSummaryMode')}
                          <select
                            className={selectControlClass}
                            value={contextCompaction.summaryMode}
                            onChange={(e) => updateContextCompaction({ summaryMode: e.target.value })}
                          >
                            <option value="heuristic">{t('qwicksCompactionSummaryHeuristic')}</option>
                            <option value="model">{t('qwicksCompactionSummaryModel')}</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionSummaryTimeout')}
                          <input
                            type="number"
                            min={1000}
                            max={120000}
                            step={1000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryTimeoutMs}
                            onChange={(e) => updateContextCompaction({ summaryTimeoutMs: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionSummaryMaxTokens')}
                          <input
                            type="number"
                            min={64}
                            max={16000}
                            step={64}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryMaxTokens}
                            onChange={(e) => updateContextCompaction({ summaryMaxTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksCompactionSummaryInputBytes')}
                          <input
                            type="number"
                            min={1024}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryInputMaxBytes}
                            onChange={(e) => updateContextCompaction({ summaryInputMaxBytes: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksStreamIdleTimeout')}
                    description={t('qwicksStreamIdleTimeoutDesc')}
                    control={
                      <input
                        type="number"
                        min={0}
                        max={3600000}
                        step={1000}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.streamIdleTimeoutMs}
                        onChange={(e) =>
                          updateRuntimeTuning({ streamIdleTimeoutMs: Number(e.target.value) })
                        }
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksToolStorm')}
                    description={t('qwicksToolStormDesc')}
                    control={
                      <Toggle
                        checked={runtimeTuning.toolStorm.enabled}
                        onChange={(enabled) => updateToolStorm({ enabled })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('qwicksToolStormLimits')}
                    description={t('qwicksToolStormLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksToolStormWindowSize')}
                          <input
                            type="number"
                            min={1}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.windowSize}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ windowSize: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('qwicksToolStormThreshold')}
                          <input
                            type="number"
                            min={2}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.threshold}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ threshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksToolArgumentRepair')}
                    description={t('qwicksToolArgumentRepairDesc')}
                    control={
                      <input
                        type="number"
                        min={1024}
                        max={16777216}
                        step={1024}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.toolArgumentRepair.maxStringBytes}
                        onChange={(e) => updateToolArgumentRepair({ maxStringBytes: Number(e.target.value) })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('qwicksDiagnostics')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('qwicksDiagnosticsAdvanced')}
                      description={t('qwicksDiagnosticsAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('qwicksRuntimeCapabilities')}
                    description={t('qwicksRuntimeCapabilitiesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          {[
                            ['MCP', runtimeInfo?.capabilities?.mcp?.status],
                            ['Web', runtimeInfo?.capabilities?.web?.status],
                            ['Skills', runtimeInfo?.capabilities?.skills?.status],
                            ['Subagents', runtimeInfo?.capabilities?.subagents?.status],
                            ['Images', runtimeInfo?.capabilities?.attachments?.status],
                            ['Memory', runtimeInfo?.capabilities?.memory?.status]
                          ].map(([label, status]) => (
                            <span
                              key={label}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${statusPill(status as string | undefined)}`}
                            >
                              {label}
                              <span className="font-mono text-[11px] opacity-75">{status || 'unknown'}</span>
                            </span>
                          ))}
                        </div>
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('qwicksRuntimeModel')}: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.model?.id ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('qwicksRuntimePid')}: <span className="font-mono text-ds-ink">{runtimeInfo?.pid ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            MCP: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.mcp?.connectedServers ?? 0}/{runtimeInfo?.capabilities?.mcp?.configuredServers ?? 0}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            Web: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.web?.provider ?? 'none'}</span>
                          </div>
                          {runtimeInfo?.capabilities?.subagents?.enabled ? (
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              Subagents: <span className="font-mono text-ds-ink">
                                {runtimeInfo?.capabilities?.subagents?.maxParallel ?? 0}∥ · {runtimeInfo?.capabilities?.subagents?.maxChildRuns ?? 0} max
                                {runtimeInfo?.capabilities?.subagents?.defaultToolPolicy ? ` · ${runtimeInfo.capabilities.subagents.defaultToolPolicy}` : ''}
                                {runtimeInfo?.capabilities?.subagents?.profiles?.length ? ` · ${runtimeInfo.capabilities.subagents.profiles.length} profile(s)` : ''}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshQWicksDiagnostics()}
                            disabled={runtimeDiagnosticsBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${runtimeDiagnosticsBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('qwicksDiagnosticsRefresh')}
                          </button>
                          {runtimeDiagnosticsNotice ? <InlineNoticeView notice={runtimeDiagnosticsNotice} /> : null}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksToolDiagnostics')}
                    description={t('qwicksToolDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('qwicksDiagnosticsProviders')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.providers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('qwicksDiagnosticsMcpServers')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpServers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('qwicksDiagnosticsSkills')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.skills?.skills?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('qwicksDiagnosticsAttachments')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.attachments?.count ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('qwicksMemoryRecords')}
                    description={t('qwicksMemoryRecordsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        {memoryRecords.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('qwicksMemoryEmpty')}
                          </div>
                        ) : (
                          memoryRecords.slice(0, 8).map((memory: any) => (
                            <div key={memory.id} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-semibold text-ds-ink">{memory.content}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{memory.scope}</span>
                                    <span className="font-mono">{memory.id}</span>
                                    {memory.disabledAt ? <span>{t('qwicksMemoryDisabled')}</span> : null}
                                    {memory.tags?.length ? <span>{compactList(memory.tags, '')}</span> : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={Boolean(memory.disabledAt)}
                                    onClick={() => void disableMemoryRecord(memory.id)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                                    aria-label={t('qwicksMemoryDisable')}
                                    title={t('qwicksMemoryDisable')}
                                  >
                                    <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteMemoryRecord(memory.id)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                                    aria-label={t('qwicksMemoryDelete')}
                                    title={t('qwicksMemoryDelete')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>
            </>
  )
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (state === 'denied') {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  }
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function ComputerUsePermissionRow({ t }: { t: (key: string) => string }): ReactElement | null {
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)

  const refresh = (): void => {
    void window.qwicksGui?.getComputerUsePermissions?.().then(setPermissions).catch(() => undefined)
  }
  useEffect(() => {
    refresh()
  }, [])

  // Non-macOS hosts have no OS permission gate; nothing useful to show.
  if (permissions && !permissions.needsPermission) return null

  const request = (kind: ComputerUsePermissionKind): void => {
    void window.qwicksGui
      ?.requestComputerUsePermission?.(kind)
      .then(setPermissions)
      .catch(() => undefined)
  }

  const badge = (label: string, state: ComputerUsePermissionState): ReactNode => (
    <span className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}>
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingRow
      title={t('computerUsePermissions')}
      description={t('computerUsePermissionsDesc')}
      control={
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {permissions?.accessibilityNeedsRestart ? (
              <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                {t('computerUseAccessibility')}: {t('computerUsePermissionNeedsRestart')}
              </span>
            ) : (
              badge(t('computerUseAccessibility'), permissions?.accessibility ?? 'unknown')
            )}
            {badge(t('computerUseScreenRecording'), permissions?.screenRecording ?? 'unknown')}
          </div>
          {permissions?.accessibilityNeedsRestart ? (
            <p className="max-w-full text-[12px] leading-5 text-amber-700 dark:text-amber-200">
              {t('computerUseRestartHint')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('accessibility')}
            >
              {t('computerUseGrantAccessibility')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('screenRecording')}
            >
              {t('computerUseGrantScreenRecording')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={refresh}
            >
              {t('computerUseRecheck')}
            </button>
          </div>
        </div>
      }
    />
  )
}

// --- Built-in skill config panel -------------------------------------------------

const PROTOCOL_SOURCES: Record<string, readonly string[]> = {
  'imageGeneration.protocol': IMAGE_GENERATION_PROTOCOLS,
  'textToSpeech.protocol': TEXT_TO_SPEECH_PROTOCOLS,
  'musicGeneration.protocol': MUSIC_GENERATION_PROTOCOLS,
  'videoGeneration.protocol': VIDEO_GENERATION_PROTOCOLS
}

const CUSTOM_PROVIDER_IDS: Record<string, string> = {
  imageGeneration: CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  textToSpeech: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  musicGeneration: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  videoGeneration: CUSTOM_VIDEO_GENERATION_PROVIDER_ID
}

function mediaTypeFromSettingsPath(settingsPath: string): string | undefined {
  const match = /^agents\.qwicks\.(imageGeneration|textToSpeech|musicGeneration|videoGeneration)\./.exec(settingsPath)
  return match?.[1]
}

/**
 * Current value of a config field. `settingsPath` (e.g.
 * "agents.qwicks.imageGeneration.apiKey") resolves against ctx.qwicks, which is
 * settings.agents.qwicks, so the "agents.qwicks." prefix is stripped. Without a
 * settingsPath the value is read from the generic skillConfigs store, falling
 * back to the field default.
 */
function readFieldValue(
  qwicks: Record<string, unknown>,
  skillId: string,
  field: SkillConfigField
): string | number | boolean | undefined {
  if (field.settingsPath) {
    const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
    const parts = localPath.split('.')
    let node: unknown = qwicks
    for (const part of parts) {
      node = (node as Record<string, unknown>)?.[part]
      if (node === undefined) break
    }
    if (node !== undefined) return node as string | number | boolean
  } else {
    const store = (qwicks.skillConfigs ?? {}) as Record<string, Record<string, string | number | boolean>>
    const stored = store[skillId]?.[field.key]
    if (stored !== undefined) return stored
  }
  return field.default
}

/**
 * Build a qwicks-level patch that writes the field value back to its source:
 * settingsPath -> nested qwicks object; otherwise -> skillConfigs[skillId][key].
 */
function buildFieldPatch(
  qwicks: Record<string, unknown>,
  skillId: string,
  field: SkillConfigField,
  value: string | number | boolean
): Record<string, unknown> {
  if (field.settingsPath) {
    const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
    const parts = localPath.split('.')
    const patch: Record<string, unknown> = {}
    let node: Record<string, unknown> = patch
    for (let i = 0; i < parts.length - 1; i++) {
      const next: Record<string, unknown> = {}
      node[parts[i] as string] = next
      node = next
    }
    node[parts[parts.length - 1] as string] = value
    return patch
  }
  const existing = (qwicks.skillConfigs ?? {}) as Record<string, Record<string, string | number | boolean>>
  return {
    skillConfigs: {
      ...existing,
      [skillId]: { ...(existing[skillId] ?? {}), [field.key]: value }
    }
  }
}

/**
 * Enum options for a field. Static options win; otherwise derive from the
 * settingsPath suffix (protocol constants / provider list / known media values).
 */
function resolveEnumOptions(
  field: SkillConfigField,
  providers: ModelProviderProfileV1[]
): { value: string; label: string }[] {
  if (field.options && field.options.length > 0) return field.options
  if (!field.settingsPath) return []
  const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
  const protocolSource = PROTOCOL_SOURCES[localPath]
  if (protocolSource) {
    return protocolSource.map((p) => ({ value: p, label: p }))
  }
  const mediaType = mediaTypeFromSettingsPath(field.settingsPath)
  if (mediaType && localPath.endsWith('.providerId')) {
    const opts = providers
      .filter((p) => Boolean((p as Record<string, unknown>)[mediaType]))
      .map((p) => ({ value: p.id, label: p.name }))
    opts.push({ value: CUSTOM_PROVIDER_IDS[mediaType] ?? 'custom', label: 'custom' })
    return opts
  }
  if (localPath.endsWith('.format')) {
    return [{ value: 'mp3', label: 'mp3' }, { value: 'wav', label: 'wav' }, { value: 'flac', label: 'flac' }]
  }
  if (localPath.endsWith('.defaultResolution')) {
    return [{ value: '768P', label: '768P' }, { value: '1080P', label: '1080P' }]
  }
  return []
}

/**
 * Whether this media skill currently has a real provider selected (not custom),
 * so credential fields (apiKey/baseUrl/model) render read-only as inherited.
 */
function isUsingRealProvider(qwicks: Record<string, unknown>, field: SkillConfigField): boolean {
  if (!field.settingsPath) return false
  const mediaType = mediaTypeFromSettingsPath(field.settingsPath)
  if (!mediaType) return false
  const providerId = ((qwicks[mediaType] as Record<string, unknown>)?.providerId ?? '') as string
  const customId = CUSTOM_PROVIDER_IDS[mediaType]
  return Boolean(providerId) && providerId !== customId
}

function SkillConfigFieldRow(input: {
  field: SkillConfigField
  skill: SkillListItem
  qwicks: Record<string, unknown>
  providers: ModelProviderProfileV1[]
  providerName: string | undefined
  t: (key: string, values?: Record<string, unknown>) => string
  onWrite: (patch: Record<string, unknown>) => void
}): ReactElement {
  const { field, skill, qwicks, providers, providerName, t, onWrite } = input
  const value = readFieldValue(qwicks, skill.id, field)
  const label = t(field.label)
  const description = field.description ? t(field.description) : undefined
  const inheritedFromProvider =
    isUsingRealProvider(qwicks, field) &&
    (field.key === 'apiKey' || field.key === 'baseUrl' || field.key === 'model')

  let control: ReactElement
  if (inheritedFromProvider) {
    control = (
      <div className="flex items-center gap-2">
        <code className="rounded bg-ds-main/60 px-2 py-1 font-mono text-[12px] text-ds-muted">
          {field.type === 'secret' ? '••••' : String(value ?? '')}
        </code>
        <span className="text-[12px] text-ds-faint">
          {t('skillConfigFromProvider', { provider: providerName ?? '' })}
        </span>
      </div>
    )
  } else if (field.type === 'boolean') {
    control = <Toggle checked={value === true} onChange={(v) => onWrite(buildFieldPatch(qwicks, skill.id, field, v))} />
  } else if (field.type === 'secret') {
    control = (
      <SecretInput
        value={typeof value === 'string' ? value : ''}
        onChange={(v) => onWrite(buildFieldPatch(qwicks, skill.id, field, v))}
        visible={false}
        onToggleVisibility={() => {}}
        showLabel={t('showSecret')}
        hideLabel={t('hideSecret')}
        className="md:max-w-md"
      />
    )
  } else if (field.type === 'number') {
    control = (
      <input
        type="number"
        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
        value={typeof value === 'number' ? value : Number(value ?? 0)}
        onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, Number(e.target.value)))}
      />
    )
  } else if (field.type === 'enum') {
    const options = resolveEnumOptions(field, providers)
    control = (
      <select
        className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, e.target.value))}
      >
        <option value="">{t('modelSelectDefaultOption', { model: options[0]?.label ?? '' })}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else {
    control = (
      <input
        className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder ?? ''}
        onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, e.target.value))}
      />
    )
  }

  return <SettingRow title={label} description={description} control={control} />
}

function BuiltinSkillConfigCard(input: {
  skill: SkillListItem
  qwicks: Record<string, unknown>
  providers: ModelProviderProfileV1[]
  t: (key: string, values?: Record<string, unknown>) => string
  updateQWicks: (patch: Record<string, unknown>) => void
}): ReactElement {
  const { skill, qwicks, providers, t, updateQWicks } = input
  const [open, setOpen] = useState(false)
  const fields = skill.configSchema?.fields ?? []
  const providerField = fields.find((f) => f.key === 'providerId')
  const providerId = providerField ? String(readFieldValue(qwicks, skill.id, providerField) ?? '') : ''
  const providerName = providers.find((p) => p.id === providerId)?.name
  const requiredMissing = fields
    .filter((f) => f.required)
    .some((f) => {
      const v = readFieldValue(qwicks, skill.id, f)
      return v === undefined || v === '' || (typeof v === 'string' && !v.trim())
    })

  return (
    <div className="rounded-xl border border-ds-border bg-ds-card px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
          {skill.name}
          {requiredMissing ? (
            <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
              {t('skillConfigUnconfigured')}
            </span>
          ) : null}
        </span>
        <span className="text-[12px] text-ds-muted">{open ? t('collapse') : t('expand')}</span>
      </button>
      {open ? (
        <div className="mt-3 divide-y divide-ds-border-muted">
          {fields.map((field) => (
            <SkillConfigFieldRow
              key={field.key}
              field={field}
              skill={skill}
              qwicks={qwicks}
              providers={providers}
              providerName={providerName}
              t={t}
              onWrite={updateQWicks}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

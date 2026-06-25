import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_QWICKS_DATA_DIR,
  DEFAULT_QWICKS_MODEL,
  DEFAULT_QWICKS_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  normalizeModelEndpointFormat,
  type AppSettingsV1,
  type QWicksComputerUseSettingsV1,
  type QWicksContextCompactionSettingsV1,
  type QWicksDesignQualitySettingsV1,
  type QWicksDesignQualityStrictness,
  type QWicksHistoryHygieneSettingsV1,
  type QWicksImageGenerationSettingsV1,
  type QWicksMcpSearchSettingsV1,
  type QWicksMemoryBackend,
  type QWicksMusicGenerationSettingsV1,
  type QWicksRuntimeTuningSettingsV1,
  type QWicksRuntimeSettingsPatchV1,
  type QWicksRuntimeSettingsV1,
  type QWicksSettingsEnvelopePatchV1,
  type QWicksSettingsEnvelopeV1,
  type QWicksSpeechToTextSettingsV1,
  type QWicksStorageSettingsV1,
  type QWicksTextToSpeechSettingsV1,
  type QWicksTokenEconomySettingsV1,
  type QWicksVideoGenerationSettingsV1,
  type ImageGenerationProtocol,
  type MusicGenerationProtocol,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelProviderSettingsV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol,
  type ApprovalPolicy,
  type SandboxMode
} from './app-settings-types'
import {
  normalizeModelProviderSettings,
  resolveQWicksRuntimeSettings
} from './app-settings-provider'

const LEGACY_COREAGENT_DATA_DIR = '~/.deepseekgui/coreagent'
const LEGACY_QWICKS_DEFAULT_MODEL = 'deepseek-chat'
const LEGACY_LOCAL_HTTP_DEFAULT_PORT = 7878

type LegacyLocalHttpRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  apiKey: string
  baseUrl: string
  runtimeToken: string
  extraCorsOrigins: string[]
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
}

type LegacyReasoningEffort = 'low' | 'medium' | 'high' | 'max'
type LegacyReasoningEditMode = 'review' | 'auto' | 'yolo' | 'plan'

type LegacyReasoningRuntimeSettingsV1 = {
  binaryPath: string
  autoStart: boolean
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: LegacyReasoningEffort
  editMode: LegacyReasoningEditMode
}

/**
 * QWicks runtime settings. Mirrors the `qwicks serve` CLI
 * options. It is the only active agent settings object the GUI
 * stores after legacy settings have been migrated.
 */
function legacyLocalHttpRuntimeDefaults(port = 7878): LegacyLocalHttpRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    runtimeToken: '',
    extraCorsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE
  }
}

function legacyReasoningRuntimeDefaults(): LegacyReasoningRuntimeSettingsV1 {
  return {
    binaryPath: '',
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    model: LEGACY_QWICKS_DEFAULT_MODEL,
    reasoningEffort: 'medium',
    editMode: 'auto'
  }
}

/** Resolve a possibly-absent memoryBackend from saved settings (old installs predate the field). */
export function resolveMemoryBackend(raw: { memoryBackend?: unknown } | undefined): QWicksMemoryBackend {
  return raw?.memoryBackend === 'dream' ? 'dream' : 'file'
}

/** Batch F:解析数据控制设置(旧安装缺该字段 → 默认全关,零外发)。 */
export function resolveDataControl(
  raw: { dataControl?: unknown } | undefined
): { allowModelImprovement: boolean; allowTraining: boolean } {
  const dc = (raw?.dataControl ?? {}) as { allowModelImprovement?: unknown; allowTraining?: unknown }
  return {
    allowModelImprovement: dc.allowModelImprovement === true,
    allowTraining: dc.allowTraining === true
  }
}

export function defaultQWicksRuntimeSettings(
  port = DEFAULT_QWICKS_PORT
): QWicksRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: '',
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    runtimeToken: '',
    dataDir: DEFAULT_QWICKS_DATA_DIR,
    model: DEFAULT_QWICKS_MODEL,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    tokenEconomyMode: false,
    tokenEconomy: defaultQWicksTokenEconomySettings(),
    insecure: false,
    mcpSearch: defaultQWicksMcpSearchSettings(),
    storage: defaultQWicksStorageSettings(),
    contextCompaction: defaultQWicksContextCompactionSettings(),
    runtimeTuning: defaultQWicksRuntimeTuningSettings(),
    imageGeneration: defaultQWicksImageGenerationSettings(),
    speechToText: defaultQWicksSpeechToTextSettings(),
    textToSpeech: defaultQWicksTextToSpeechSettings(),
    musicGeneration: defaultQWicksMusicGenerationSettings(),
    videoGeneration: defaultQWicksVideoGenerationSettings(),
    modelProfiles: {},
    memoryEnabled: false,
    memoryBackend: 'file',
    dataControl: { allowModelImprovement: false, allowTraining: false },
    computerUse: defaultQWicksComputerUseSettings(),
    quality: defaultQWicksQualitySettings()
  }
}

export function defaultQWicksQualitySettings(): QWicksDesignQualitySettingsV1 {
  return {
    enabled: true,
    strictness: 'standard',
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
}

export function defaultQWicksComputerUseSettings(): QWicksComputerUseSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
}

export function defaultQWicksImageGenerationSettings(): QWicksImageGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultSize: '',
    timeoutMs: 180_000
  }
}

export function defaultQWicksSpeechToTextSettings(): QWicksSpeechToTextSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    language: '',
    timeoutMs: 60_000
  }
}

export function defaultQWicksTextToSpeechSettings(): QWicksTextToSpeechSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    voice: '',
    format: 'mp3',
    timeoutMs: 120_000
  }
}

export function defaultQWicksMusicGenerationSettings(): QWicksMusicGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    format: 'mp3',
    timeoutMs: 300_000
  }
}

export function defaultQWicksVideoGenerationSettings(): QWicksVideoGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultDuration: 6,
    defaultResolution: '1080P',
    timeoutMs: 900_000,
    pollIntervalMs: 10_000
  }
}

export function defaultQWicksMcpSearchSettings(): QWicksMcpSearchSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultQWicksTokenEconomySettings(): QWicksTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultQWicksHistoryHygieneSettings()
  }
}

export function defaultQWicksHistoryHygieneSettings(): QWicksHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultQWicksStorageSettings(): QWicksStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export function defaultQWicksContextCompactionSettings(): QWicksContextCompactionSettingsV1 {
  return {
    defaultSoftThreshold: 96_000,
    defaultHardThreshold: 108_800,
    // Default to model-generated summaries (codex-style): the model writes a
    // structured recap of the folded turns instead of a mechanical item list.
    // Falls back to the heuristic summary automatically on timeout/failure.
    summaryMode: 'model',
    summaryTimeoutMs: 15_000,
    summaryMaxTokens: 1_200,
    summaryInputMaxBytes: 96 * 1024
  }
}

export function defaultQWicksRuntimeTuningSettings(): QWicksRuntimeTuningSettingsV1 {
  return {
    streamIdleTimeoutMs: 45_000,
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 512 * 1024
    }
  }
}

export function getQWicksRuntimeSettings(
  settings: AppSettingsV1
): QWicksRuntimeSettingsV1 {
  const raw = (settings as { agents?: { qwicks?: Partial<QWicksRuntimeSettingsV1> } }).agents?.qwicks
  return mergeQWicksRuntimeSettings(defaultQWicksRuntimeSettings(), raw)
}

export function qwicksSettingsEnvelope(
  qwicks: QWicksRuntimeSettingsV1
): QWicksSettingsEnvelopeV1 {
  return { qwicks }
}

export function qwicksSettingsPatch(
  qwicks: QWicksRuntimeSettingsPatchV1 | undefined
): QWicksSettingsEnvelopePatchV1 {
  return qwicks ? { qwicks } : {}
}

export function mergeQWicksRuntimeSettings(
  current: QWicksRuntimeSettingsV1,
  patch: QWicksRuntimeSettingsPatchV1 | undefined
): QWicksRuntimeSettingsV1 {
  const currentMcpSearch = normalizeQWicksMcpSearchSettings(current.mcpSearch)
  const nextMcpSearch = normalizeQWicksMcpSearchSettings({
    ...currentMcpSearch,
    ...(patch?.mcpSearch ?? {})
  })
  const currentTokenEconomy = normalizeQWicksTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeQWicksTokenEconomySettings({
    ...currentTokenEconomy,
    ...(patch?.tokenEconomy ?? {}),
    historyHygiene: {
      ...currentTokenEconomy.historyHygiene,
      ...(patch?.tokenEconomy?.historyHygiene ?? {})
    }
  }, currentTokenEconomy.enabled)
  const tokenEconomyEnabled = typeof patch?.tokenEconomy?.enabled === 'boolean'
    ? patch.tokenEconomy.enabled
    : typeof patch?.tokenEconomyMode === 'boolean'
      ? patch.tokenEconomyMode
      : patchedTokenEconomy.enabled
  const nextTokenEconomy = {
    ...patchedTokenEconomy,
    enabled: tokenEconomyEnabled
  }
  const currentStorage = normalizeQWicksStorageSettings(current.storage)
  const nextStorage = normalizeQWicksStorageSettings({
    ...currentStorage,
    ...(patch?.storage ?? {})
  })
  const currentContextCompaction = normalizeQWicksContextCompactionSettings(current.contextCompaction)
  const contextCompactionPatch = patch?.contextCompaction ?? {}
  const nextContextCompactionInput = {
    ...currentContextCompaction,
    ...contextCompactionPatch
  }
  if (
    contextCompactionPatch.defaultSoftThreshold !== undefined &&
    contextCompactionPatch.defaultHardThreshold === undefined
  ) {
    nextContextCompactionInput.defaultHardThreshold = contextCompactionPatch.defaultSoftThreshold
  }
  const nextContextCompaction = normalizeQWicksContextCompactionSettings(nextContextCompactionInput)
  const currentImageGeneration = normalizeQWicksImageGenerationSettings(current.imageGeneration)
  const nextImageGeneration = normalizeQWicksImageGenerationSettings({
    ...currentImageGeneration,
    ...(patch?.imageGeneration ?? {})
  })
  const currentSpeechToText = normalizeQWicksSpeechToTextSettings(current.speechToText)
  const nextSpeechToText = normalizeQWicksSpeechToTextSettings({
    ...currentSpeechToText,
    ...(patch?.speechToText ?? {})
  })
  const currentTextToSpeech = normalizeQWicksTextToSpeechSettings(current.textToSpeech)
  const nextTextToSpeech = normalizeQWicksTextToSpeechSettings({
    ...currentTextToSpeech,
    ...(patch?.textToSpeech ?? {})
  })
  const currentMusicGeneration = normalizeQWicksMusicGenerationSettings(current.musicGeneration)
  const nextMusicGeneration = normalizeQWicksMusicGenerationSettings({
    ...currentMusicGeneration,
    ...(patch?.musicGeneration ?? {})
  })
  const currentVideoGeneration = normalizeQWicksVideoGenerationSettings(current.videoGeneration)
  const nextVideoGeneration = normalizeQWicksVideoGenerationSettings({
    ...currentVideoGeneration,
    ...(patch?.videoGeneration ?? {})
  })
  const currentComputerUse = normalizeQWicksComputerUseSettings(current.computerUse)
  const nextComputerUse = normalizeQWicksComputerUseSettings({
    ...currentComputerUse,
    ...(patch?.computerUse ?? {})
  })
  const currentQuality = normalizeQWicksQualitySettings(current.quality)
  const nextQuality = normalizeQWicksQualitySettings({
    ...currentQuality,
    ...(patch?.quality ?? {})
  })
  const currentRuntimeTuning = normalizeQWicksRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeQWicksRuntimeTuningSettings({
    ...currentRuntimeTuning,
    ...(patch?.runtimeTuning
      ? {
          ...(patch.runtimeTuning.streamIdleTimeoutMs !== undefined
            ? { streamIdleTimeoutMs: patch.runtimeTuning.streamIdleTimeoutMs }
            : {}),
          toolStorm: {
            ...currentRuntimeTuning.toolStorm,
            ...(patch.runtimeTuning.toolStorm ?? {})
          },
          toolArgumentRepair: {
            ...currentRuntimeTuning.toolArgumentRepair,
            ...(patch.runtimeTuning.toolArgumentRepair ?? {})
          }
        }
      : {})
  })
  const nextModelProfiles = normalizeQWicksModelProfiles(current.modelProfiles, patch?.modelProfiles)
  return {
    ...current,
    ...(patch ?? {}),
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    mcpSearch: nextMcpSearch,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning,
    imageGeneration: nextImageGeneration,
    speechToText: nextSpeechToText,
    textToSpeech: nextTextToSpeech,
    musicGeneration: nextMusicGeneration,
    videoGeneration: nextVideoGeneration,
    modelProfiles: nextModelProfiles,
    memoryEnabled: patch?.memoryEnabled ?? current.memoryEnabled ?? false,
    memoryBackend: resolveMemoryBackend(patch?.memoryBackend ?? current.memoryBackend),
    dataControl: resolveDataControl(patch?.dataControl ?? current.dataControl),
    computerUse: nextComputerUse,
    quality: nextQuality
  }
}

function normalizeQWicksImageGenerationSettings(
  input: Partial<QWicksImageGenerationSettingsV1> | undefined
): QWicksImageGenerationSettingsV1 {
  const defaults = defaultQWicksImageGenerationSettings()
  const defaultSize = typeof input?.defaultSize === 'string' ? input.defaultSize.trim() : ''
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeQWicksImageGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultSize: /^(auto|\d+x\d+)$/.test(defaultSize) ? defaultSize : '',
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeQWicksImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  return value === 'minimax-image' ? 'minimax-image' : DEFAULT_IMAGE_GENERATION_PROTOCOL
}

function normalizeQWicksSpeechToTextSettings(
  input: Partial<QWicksSpeechToTextSettingsV1> | undefined
): QWicksSpeechToTextSettingsV1 {
  const defaults = defaultQWicksSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeQWicksSpeechToTextProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    language: typeof input?.language === 'string' ? input.language.trim().toLowerCase().slice(0, 16) : defaults.language,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeQWicksSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  return value === 'mimo-asr' ? 'mimo-asr' : DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

function normalizeQWicksTextToSpeechSettings(
  input: Partial<QWicksTextToSpeechSettingsV1> | undefined
): QWicksTextToSpeechSettingsV1 {
  const defaults = defaultQWicksTextToSpeechSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeQWicksTextToSpeechProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    voice: typeof input?.voice === 'string' ? input.voice.trim().slice(0, 128) : defaults.voice,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeQWicksTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

function normalizeQWicksMusicGenerationSettings(
  input: Partial<QWicksMusicGenerationSettingsV1> | undefined
): QWicksMusicGenerationSettingsV1 {
  const defaults = defaultQWicksMusicGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeQWicksMusicGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 900_000)
  }
}

function normalizeQWicksMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

function normalizeQWicksVideoGenerationSettings(
  input: Partial<QWicksVideoGenerationSettingsV1> | undefined
): QWicksVideoGenerationSettingsV1 {
  const defaults = defaultQWicksVideoGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeQWicksVideoGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultDuration: boundedPositiveInt(input?.defaultDuration, defaults.defaultDuration, 60),
    defaultResolution: typeof input?.defaultResolution === 'string' && input.defaultResolution.trim()
      ? input.defaultResolution.trim().slice(0, 32)
      : defaults.defaultResolution,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 1_800_000),
    pollIntervalMs: boundedPositiveInt(input?.pollIntervalMs, defaults.pollIntervalMs, 60_000)
  }
}

function normalizeQWicksVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

function normalizeQWicksComputerUseSettings(
  input: Partial<QWicksComputerUseSettingsV1> | undefined
): QWicksComputerUseSettingsV1 {
  const defaults = defaultQWicksComputerUseSettings()
  const mode = input?.mode === 'always' || input?.mode === 'off' || input?.mode === 'auto'
    ? input.mode
    : defaults.mode
  return {
    enabled: input?.enabled === true,
    mode,
    maxImageDimension: boundedPositiveInt(input?.maxImageDimension, defaults.maxImageDimension, 4096),
    maxActionsPerTurn: boundedPositiveInt(input?.maxActionsPerTurn, defaults.maxActionsPerTurn, 1000)
  }
}

function normalizeAudioFormat(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return /^(mp3|wav|flac|pcm16)$/.test(normalized) ? normalized : fallback
}

function normalizeQWicksTokenEconomySettings(
  input: Partial<QWicksTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): QWicksTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeQWicksHistoryHygieneSettings(input?.historyHygiene)
  }
}

function normalizeQWicksHistoryHygieneSettings(
  input: Partial<QWicksHistoryHygieneSettingsV1> | undefined
): QWicksHistoryHygieneSettingsV1 {
  const defaults = defaultQWicksHistoryHygieneSettings()
  return {
    maxToolResultLines: boundedPositiveInt(input?.maxToolResultLines, defaults.maxToolResultLines, 100_000),
    maxToolResultBytes: boundedPositiveInt(input?.maxToolResultBytes, defaults.maxToolResultBytes, 8 * 1024 * 1024),
    maxToolResultTokens: boundedPositiveInt(input?.maxToolResultTokens, defaults.maxToolResultTokens, 256_000),
    maxToolArgumentStringBytes: boundedPositiveInt(
      input?.maxToolArgumentStringBytes,
      defaults.maxToolArgumentStringBytes,
      8 * 1024 * 1024
    ),
    maxToolArgumentStringTokens: boundedPositiveInt(
      input?.maxToolArgumentStringTokens,
      defaults.maxToolArgumentStringTokens,
      64_000
    ),
    maxArrayItems: boundedPositiveInt(input?.maxArrayItems, defaults.maxArrayItems, 10_000)
  }
}

function normalizeQWicksMcpSearchSettings(
  input: Partial<QWicksMcpSearchSettingsV1> | undefined
): QWicksMcpSearchSettingsV1 {
  const defaults = defaultQWicksMcpSearchSettings()
  const topKMax = positiveInt(input?.topKMax, defaults.topKMax)
  const topKDefault = Math.min(positiveInt(input?.topKDefault, defaults.topKDefault), topKMax)
  return {
    enabled: input?.enabled === true,
    mode: input?.mode === 'direct' || input?.mode === 'search' || input?.mode === 'auto'
      ? input.mode
      : defaults.mode,
    autoThresholdToolCount: positiveInt(input?.autoThresholdToolCount, defaults.autoThresholdToolCount),
    topKDefault,
    topKMax,
    minScore: nonNegativeNumber(input?.minScore, defaults.minScore)
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function boundedPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

/** Like {@link boundedPositiveInt} but accepts `0` (e.g. "disabled"). */
function boundedNonNegativeInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.floor(value), max)
}

function normalizeQWicksStorageSettings(
  input: Partial<QWicksStorageSettingsV1> | undefined
): QWicksStorageSettingsV1 {
  const defaults = defaultQWicksStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

function normalizeQWicksContextCompactionSettings(
  input: Partial<QWicksContextCompactionSettingsV1> | undefined
): QWicksContextCompactionSettingsV1 {
  const defaults = defaultQWicksContextCompactionSettings()
  const defaultSoftThreshold = boundedPositiveInt(input?.defaultSoftThreshold, defaults.defaultSoftThreshold)
  const defaultHardThreshold = input?.defaultSoftThreshold !== undefined && input?.defaultHardThreshold === undefined
    ? defaultSoftThreshold
    : defaults.defaultHardThreshold
  const requestedHardThreshold = boundedPositiveInt(input?.defaultHardThreshold, defaultHardThreshold)
  return {
    defaultSoftThreshold,
    defaultHardThreshold: Math.max(defaultSoftThreshold, requestedHardThreshold),
    summaryMode: input?.summaryMode === 'model' || input?.summaryMode === 'heuristic'
      ? input.summaryMode
      : defaults.summaryMode,
    summaryTimeoutMs: boundedPositiveInt(input?.summaryTimeoutMs, defaults.summaryTimeoutMs, 120_000),
    summaryMaxTokens: boundedPositiveInt(input?.summaryMaxTokens, defaults.summaryMaxTokens, 16_000),
    summaryInputMaxBytes: boundedPositiveInt(input?.summaryInputMaxBytes, defaults.summaryInputMaxBytes, 8 * 1024 * 1024)
  }
}

function normalizeQWicksRuntimeTuningSettings(
  input: Partial<QWicksRuntimeTuningSettingsV1> | undefined
): QWicksRuntimeTuningSettingsV1 {
  const defaults = defaultQWicksRuntimeTuningSettings()
  return {
    streamIdleTimeoutMs: boundedNonNegativeInt(
      input?.streamIdleTimeoutMs,
      defaults.streamIdleTimeoutMs,
      3_600_000
    ),
    toolStorm: {
      enabled: input?.toolStorm?.enabled !== false,
      windowSize: boundedPositiveInt(input?.toolStorm?.windowSize, defaults.toolStorm.windowSize, 128),
      threshold: Math.max(2, boundedPositiveInt(input?.toolStorm?.threshold, defaults.toolStorm.threshold, 128))
    },
    toolArgumentRepair: {
      maxStringBytes: boundedPositiveInt(
        input?.toolArgumentRepair?.maxStringBytes,
        defaults.toolArgumentRepair.maxStringBytes,
        16 * 1024 * 1024
      )
    }
  }
}

const QWICKS_DESIGN_QUALITY_STRICTNESS: readonly QWicksDesignQualityStrictness[] = [
  'relaxed',
  'standard',
  'strict'
]

function normalizeQWicksQualitySettings(
  input: Partial<QWicksDesignQualitySettingsV1> | undefined
): QWicksDesignQualitySettingsV1 {
  const defaults = defaultQWicksQualitySettings()
  const strictness =
    input?.strictness && QWICKS_DESIGN_QUALITY_STRICTNESS.includes(input.strictness)
      ? input.strictness
      : defaults.strictness
  const sanitizeList = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : defaults.ignoreRules
  return {
    enabled: input?.enabled !== false,
    strictness,
    ignoreRules: sanitizeList(input?.ignoreRules),
    ignoreFiles: sanitizeList(input?.ignoreFiles),
    maxFindings: boundedPositiveInt(input?.maxFindings, defaults.maxFindings, 100)
  }
}

function normalizeQWicksModelProfiles(
  current: Record<string, ModelProviderModelProfileV1> | undefined,
  patch: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, rawProfile] of Object.entries(current ?? {})) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    profiles[modelId] = normalizeQWicksModelProfile(rawProfile)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return profiles
  for (const [rawModelId, rawProfile] of Object.entries(patch)) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    if (rawProfile === null) {
      delete profiles[modelId]
      continue
    }
    profiles[modelId] = normalizeQWicksModelProfile({
      ...(profiles[modelId] ?? {}),
      ...rawProfile
    })
  }
  return profiles
}

function normalizeQWicksModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeQWicksModelInputModalities(input?.inputModalities)
  const fallbackMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = typeof input?.contextWindowTokens === 'number' &&
    Number.isInteger(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : undefined
  const reasoning = normalizeQWicksReasoningCapability(input?.reasoning)
  const endpointFormat = typeof input?.endpointFormat === 'string' && input.endpointFormat.trim()
    ? normalizeModelEndpointFormat(input.endpointFormat)
    : undefined
  return {
    ...(normalizeQWicksProfileAliases(input?.aliases).length
      ? { aliases: normalizeQWicksProfileAliases(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities,
    outputModalities: normalizeQWicksModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeQWicksModelMessageParts(input?.messageParts, fallbackMessageParts),
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

function normalizeQWicksReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeQWicksReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeQWicksReasoningEffort(input.defaultEffort)
  const requestProtocol = normalizeQWicksReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort && supportedEfforts.includes(defaultEffort)
      ? defaultEffort
      : supportedEfforts[0],
    requestProtocol
  }
}

function normalizeQWicksReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const efforts: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeQWicksReasoningEffort(item)
    if (effort && !efforts.includes(effort)) efforts.push(effort)
  }
  return efforts
}

function normalizeQWicksReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

function normalizeQWicksReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

function normalizeModelProfileId(value: string): string {
  return value.trim().slice(0, 128)
}

function normalizeQWicksProfileAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const aliases: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const alias = item.trim().slice(0, 128)
    if (alias && !aliases.includes(alias)) aliases.push(alias)
    if (aliases.length >= 50) break
  }
  return aliases
}

function normalizeQWicksModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const modalities: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !modalities.includes(item)) {
      modalities.push(item)
    }
    if (modalities.length >= 8) break
  }
  return modalities.length > 0 ? modalities : ['text']
}

function normalizeQWicksModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const parts: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !parts.includes(item)
    ) {
      parts.push(item)
    }
    if (parts.length >= 8) break
  }
  return parts.length > 0 ? parts : [...fallback]
}

export function withQWicksRuntimeSettings(
  settings: AppSettingsV1,
  qwicks: QWicksRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: qwicksSettingsEnvelope(qwicks)
  }
}

export function applyQWicksRuntimePatch(
  settings: AppSettingsV1,
  patch: QWicksRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withQWicksRuntimeSettings(
    settings,
    mergeQWicksRuntimeSettings(getQWicksRuntimeSettings(settings), patch)
  )
}

export function isQWicksRuntimeInsecure(runtime: Pick<QWicksRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure || !runtime.runtimeToken.trim()
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveQWicksRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: QWicksSettingsEnvelopeV1,
  patch: QWicksSettingsEnvelopePatchV1 | undefined
): QWicksSettingsEnvelopeV1 {
  return qwicksSettingsEnvelope(
    mergeQWicksRuntimeSettings(defaults.qwicks, patch?.qwicks)
  )
}

type LegacyAgentsSettingsShape = {
  qwicks?: Partial<QWicksRuntimeSettingsV1>
  codewhale?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  reasonix?: Partial<LegacyReasoningRuntimeSettingsV1>
}

type LegacyAppSettingsShape = Partial<Omit<AppSettingsV1, 'agents' | 'provider'>> & {
  agents?: LegacyAgentsSettingsShape
  provider?: Partial<ModelProviderSettingsV1>
  deepseek?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  /** Legacy single-provider discriminator. Read only inside migration. */
  agentProvider?: unknown
}

function nonEmptyStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function upgradeLegacyQWicksDefaultDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_QWICKS_DATA_DIR
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase()
  if (
    !trimmed ||
    normalized === LEGACY_COREAGENT_DATA_DIR ||
    normalized.endsWith('/.deepseekgui/coreagent')
  ) {
    return DEFAULT_QWICKS_DATA_DIR
  }
  return trimmed
}

function upgradeLegacyQWicksDefaultModel(value: unknown, fallback: string): string {
  const model = nonEmptyStringOrFallback(value, fallback).trim()
  return model === LEGACY_QWICKS_DEFAULT_MODEL ? DEFAULT_QWICKS_MODEL : model
}

function upgradeLegacyQWicksDefaultPort(value: unknown, fallback: number): number {
  return value === LEGACY_LOCAL_HTTP_DEFAULT_PORT ? DEFAULT_QWICKS_PORT : fallback
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const rawAgentProvider = parsed.agentProvider
  const isReasoningLegacy = rawAgentProvider === 'reasonix'
  const hasProviderSettings = typeof parsed.provider === 'object' && parsed.provider !== null
  const defaults = legacyLocalHttpRuntimeDefaults()
  const qwicksDefaults = defaultQWicksRuntimeSettings()
  const legacyDeepseek = parsed.deepseek ?? {}
  const legacyLocalHttp = {
    ...defaults,
    ...(parsed.agents?.codewhale ?? {}),
    ...legacyDeepseek
  }
  const legacyReasoning = {
    ...legacyReasoningRuntimeDefaults(),
    ...(parsed.agents?.reasonix ?? {})
  }
  const explicitQWicks: Partial<QWicksRuntimeSettingsV1> = parsed.agents?.qwicks ?? {}
  const legacySource = isReasoningLegacy ? legacyReasoning : legacyLocalHttp
  const legacySeed = {
    binaryPath: qwicksDefaults.binaryPath,
    port: isReasoningLegacy
      ? qwicksDefaults.port
      : upgradeLegacyQWicksDefaultPort(legacyLocalHttp.port, legacyLocalHttp.port),
    autoStart: isReasoningLegacy ? legacyReasoning.autoStart : legacyLocalHttp.autoStart,
    apiKey: legacySource.apiKey,
    baseUrl: legacySource.baseUrl,
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    runtimeToken: isReasoningLegacy ? qwicksDefaults.runtimeToken : legacyLocalHttp.runtimeToken,
    model: isReasoningLegacy ? legacyReasoning.model : qwicksDefaults.model,
    approvalPolicy: isReasoningLegacy ? qwicksDefaults.approvalPolicy : legacyLocalHttp.approvalPolicy,
    sandboxMode: isReasoningLegacy ? qwicksDefaults.sandboxMode : legacyLocalHttp.sandboxMode
  }
  const provider = normalizeModelProviderSettings({
    apiKey: hasProviderSettings
      ? parsed.provider?.apiKey
      : nonEmptyStringOrFallback(explicitQWicks.apiKey, legacySeed.apiKey),
    baseUrl: hasProviderSettings
      ? parsed.provider?.baseUrl
      : nonEmptyStringOrFallback(explicitQWicks.baseUrl, legacySeed.baseUrl),
    providers: parsed.provider?.providers
  })
  const qwicks = {
    ...qwicksDefaults,
    ...legacySeed,
    ...explicitQWicks,
    apiKey: hasProviderSettings ? explicitQWicks.apiKey ?? '' : '',
    baseUrl: hasProviderSettings ? explicitQWicks.baseUrl ?? '' : '',
    runtimeToken: nonEmptyStringOrFallback(explicitQWicks.runtimeToken, legacySeed.runtimeToken),
    dataDir: upgradeLegacyQWicksDefaultDataDir(explicitQWicks.dataDir),
    model: upgradeLegacyQWicksDefaultModel(explicitQWicks.model, legacySeed.model),
    tokenEconomyMode: typeof explicitQWicks.tokenEconomy?.enabled === 'boolean'
      ? explicitQWicks.tokenEconomy.enabled
      : explicitQWicks.tokenEconomyMode ?? qwicksDefaults.tokenEconomyMode,
    tokenEconomy: normalizeQWicksTokenEconomySettings(
      explicitQWicks.tokenEconomy,
      explicitQWicks.tokenEconomyMode ?? qwicksDefaults.tokenEconomyMode
    ),
    mcpSearch: normalizeQWicksMcpSearchSettings(explicitQWicks.mcpSearch),
    storage: normalizeQWicksStorageSettings(explicitQWicks.storage),
    contextCompaction: normalizeQWicksContextCompactionSettings(explicitQWicks.contextCompaction),
    runtimeTuning: normalizeQWicksRuntimeTuningSettings(explicitQWicks.runtimeTuning),
    imageGeneration: normalizeQWicksImageGenerationSettings(explicitQWicks.imageGeneration),
    speechToText: normalizeQWicksSpeechToTextSettings(explicitQWicks.speechToText),
    textToSpeech: normalizeQWicksTextToSpeechSettings(explicitQWicks.textToSpeech),
    musicGeneration: normalizeQWicksMusicGenerationSettings(explicitQWicks.musicGeneration),
    videoGeneration: normalizeQWicksVideoGenerationSettings(explicitQWicks.videoGeneration),
    quality: normalizeQWicksQualitySettings(explicitQWicks.quality)
  }
  // Strip the legacy `agentProvider` discriminator and the legacy
  // per-provider settings from the surfaced migration result. The
  // runtime now has a single agent (QWicks) and we no longer
  // round-trip the legacy value into the new settings shape.
  const { deepseek: _legacyDeepseek, agents: _agents, agentProvider: _agentProvider, ...rest } = parsed
  void _legacyDeepseek
  void _agents
  void _agentProvider
  return {
    ...rest,
    provider,
    agents: {
      qwicks
    }
  }
}

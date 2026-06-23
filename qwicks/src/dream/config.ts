/**
 * Dream 系统配置。1:1 对齐 Python `dream/config.py` 的结构,但按 TS-port 的架构决策
 * 调整默认后端:
 *  - storage: 仅 sqlite(对齐决策;Python 的 postgres 后端有 bug,不移植)
 *  - embedding: http(调用 OpenAI 兼容 embedding 服务)优先 + hash 回退(对齐决策)
 *  - vector_db: self-built(自研 TS 向量索引;不移植 faiss/numpy)
 *  - graph: in-memory(桌面单用户不需要 Neo4j)
 *  - llm: 复用 qwicks compat-model-client
 *
 * 通过环境变量或 `DreamConfig.fromEnv()` 加载。系统所有可调项都集中在这里。
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 用户配置的"大脑"模型端点。 */
export class LLMEndpointConfig {
  constructor(
    public baseUrl: string = '',
    public apiKey: string = '',
    public model: string = '',
    public timeout: number = 60,
    public temperature: number = 0.2,
    public maxTokens: number = 1024,
    /** openai-compatible | openai | anthropic | mock */
    public provider: 'openai-compatible' | 'openai' | 'anthropic' | 'mock' = 'openai-compatible'
  ) {}
}

/** SQLite 存储配置(决策:仅 sqlite)。 */
export class StorageConfig {
  constructor(
    /** 决策:固定 sqlite(保留字段以兼容 Python 形态) */
    public backend: 'sqlite' = 'sqlite',
    public sqlitePath: string = 'dream_memory.db',
    public echo: boolean = false
  ) {}
}

/** Embedding 配置。 */
export class EmbeddingConfig {
  constructor(
    /** http(调用 embedding 服务)优先,hash 回退 */
    public backend: 'http' = 'http',
    public fallbackBackend: 'hash' = 'hash',
    public modelName: string = 'BAAI/bge-m3',
    /** embedding 服务端点,缺省走 qwicks model-client 的 baseUrl */
    public baseUrl: string = '',
    public apiKey: string = '',
    public dim: number = 1024,
    public batchSize: number = 8,
    public maxLength: number = 512,
    public cacheDir: string = ''
  ) {}
}

/** 向量库配置(决策:self-built)。 */
export class VectorDbConfig {
  constructor(
    public backend: 'self-built' = 'self-built',
    public persistPath: string = 'dream_vectors',
    /** flat | ivf(hnsw 不移植) */
    public indexType: 'flat' | 'ivf' = 'flat',
    public nlist: number = 100,
    public collectionName: string = 'dream_vectors'
  ) {}
}

/** 图谱配置(决策:in-memory)。 */
export class GraphConfig {
  constructor(public backend: 'in-memory' = 'in-memory') {}
}

/** 检索 / 合成通用配置。 */
export class RetrievalConfig {
  constructor(
    public topK: number = 8,
    public minScore: number = 0.15,
    public recencyHalfLifeDays: number = 60,
    /** retrieve 层硬性 recency 阈值 (0 关闭)。 < 此值的 memory 直接从 hits 中过滤 */
    public minRecency: number = 0,
    public synthesisModel: string = 'qwen3:8b',
    public extractionModel: string = 'qwen3:8b',
    public autoSummarize: boolean = true
  ) {}
}

/** Prompt 注入层配置。 */
export class PromptBuilderConfig {
  constructor(
    public maxBuckets: number = 6,
    public maxSectionChars: number = 800,
    public includeInstructions: boolean = true,
    public twinHeader: string = '以下是与该用户相关的、已经被 Dream 系统检索与合成的关键记忆：'
  ) {}
}

/** 整套 Dream 系统的统一配置。 */
export interface DreamConfigInit {
  storage?: StorageConfig
  embedding?: EmbeddingConfig
  vectorDb?: VectorDbConfig
  graph?: GraphConfig
  llm?: LLMEndpointConfig
  retrieval?: RetrievalConfig
  prompt?: PromptBuilderConfig
  userId?: string
  dataDir?: string
  debug?: boolean
}

export class DreamConfig {
  storage: StorageConfig
  embedding: EmbeddingConfig
  vectorDb: VectorDbConfig
  graph: GraphConfig
  llm: LLMEndpointConfig
  retrieval: RetrievalConfig
  prompt: PromptBuilderConfig
  userId: string
  dataDir: string
  debug: boolean

  constructor(init: DreamConfigInit = {}) {
    this.storage = init.storage ?? new StorageConfig()
    this.embedding = init.embedding ?? new EmbeddingConfig()
    this.vectorDb = init.vectorDb ?? new VectorDbConfig()
    this.graph = init.graph ?? new GraphConfig()
    this.llm = init.llm ?? new LLMEndpointConfig()
    this.retrieval = init.retrieval ?? new RetrievalConfig()
    this.prompt = init.prompt ?? new PromptBuilderConfig()
    this.userId = init.userId ?? 'default'
    this.dataDir = init.dataDir ?? 'dream_data'
    this.debug = init.debug ?? false
  }

  /**
   * 从 DREAM_LLM_* 等环境变量构造,让 qwicks runtime 直接接入(对齐 Python from_env)。
   */
  static fromEnv(opts: { userId?: string; dataDir?: string; env?: NodeJS.ProcessEnv } = {}): DreamConfig {
    const env = opts.env ?? process.env
    const str = (k: string, fallback: string): string => {
      const v = env[k]
      return v === undefined || v === '' ? fallback : v
    }
    const num = (k: string, fallback: number): number => {
      const v = env[k]
      if (v === undefined || v === '') return fallback
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
    const llm = new LLMEndpointConfig(
      str('DREAM_LLM_BASE_URL', ''),
      str('DREAM_LLM_API_KEY', ''),
      str('DREAM_LLM_MODEL', ''),
      num('DREAM_LLM_TIMEOUT', 60),
      num('DREAM_LLM_TEMPERATURE', 0.2),
      // 整数
      (() => {
        const v = env.DREAM_LLM_MAX_TOKENS
        if (v === undefined || v === '') return 1024
        const n = parseInt(v, 10)
        return Number.isFinite(n) ? n : 1024
      })(),
      (() => { const v = str('DREAM_LLM_PROVIDER', 'openai-compatible'); return v === 'openai' || v === 'anthropic' || v === 'mock' ? v : 'openai-compatible' })()
    )
    return new DreamConfig({
      llm,
      userId: opts.userId ?? str('DREAM_USER_ID', 'default'),
      dataDir: opts.dataDir ?? str('DREAM_DATA_DIR', 'dream_data')
    })
  }

  /** 计算 sqlite / vector / graph 的实际路径,并确保 dataDir 存在。 */
  resolvedPaths(): {
    dataDir: string
    sqlite: string
    vectorDir: string
    graphDump: string
  } {
    const base = resolve(this.dataDir)
    mkdirSync(base, { recursive: true })
    return {
      dataDir: base,
      sqlite: join(base, this.storage.sqlitePath || 'dream_memory.db'),
      vectorDir: join(base, this.vectorDb.persistPath),
      graphDump: join(base, 'graph.jsonl')
    }
  }
}

/**
 * 从环境变量加载配置(对齐 Python load_config)。
 * 所有变量以 `DREAM_` 开头,使用 `__` 描述嵌套键,例如 `DREAM_LLM__MODEL` 覆盖 `llm.model`。
 * 类型按当前字段类型自动转换(bool/int/float/str)。未知/畸形路径静默忽略。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DreamConfig {
  const cfg = new DreamConfig()
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('DREAM_') || value === undefined) continue
    // env token after DREAM_ is snake_case (e.g. RETRIEVAL__TOP_K); map to camelCase
    // field names so DREAM_RETRIEVAL__TOP_K -> retrieval.topK, mirroring Python's
    // snake_case field match.
    const path = key.slice('DREAM_'.length).toLowerCase().split('__').map(toCamelCase)
    applyPath(cfg, path, value)
  }
  return cfg
}

function toCamelCase(part: string): string {
  return part.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function applyPath(cfg: DreamConfig, path: string[], raw: string): void {
  if (path.length === 0) return
  let target: unknown = cfg
  for (const part of path) {
    if (target === null || typeof target !== 'object') return
    target = (target as Record<string, unknown>)[part]
    if (target === undefined) return
  }
  let coerced: unknown = raw
  if (typeof target === 'boolean') {
    coerced = ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
  } else if (typeof target === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    coerced = n
  } else if (typeof target === 'string') {
    coerced = raw
  } else {
    return
  }
  let parent: unknown = cfg
  for (const part of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') return
    parent = (parent as Record<string, unknown>)[part]
  }
  if (parent === null || typeof parent !== 'object') return
  ;(parent as Record<string, unknown>)[path[path.length - 1]!] = coerced
}

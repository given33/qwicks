/**
 * Dream Embedding 层接口(对齐 Python `dream/embeddings/base.py` 的 Embedder 协议)。
 *
 * 决策:不移植 torch/BGE-M3 本地加载(gpu_guard / gpu_offload / resident_service 都
 * 是 Python-torch 专属,桌面 Electron 不能背这么重的原生依赖)。语义质量通过 HTTP
 * provider 调用 OpenAI 兼容的 /embeddings 端点(可指向本地 Ollama bge-m3)达到同等
 * 效果。HashEmbedder 作为离线/服务不可用时的纯 TS 回退(对齐 Python HashEmbedder)。
 *
 * 严格模式(对齐 R70+ v3):
 *  - strict=true 时,HTTP provider 加载/探活失败 → 抛错,不静默退化到 hash。
 *  - allowCpuFallback=true(配置/环境变量)时,允许退化到 HashEmbedder。
 */
export interface EmbeddingHealth {
  backend: string
  device: string
  dim: number
  degraded: boolean
  error?: string
  loadAttempted: boolean
  probeOk: boolean
  /** ok | degraded | error */
  status: 'ok' | 'degraded' | 'error'
  strict: boolean
  allowCpuFallback: boolean
}

/** duck-typed embedder 协议(对齐 Python Embedder)。 */
export interface Embedder {
  name(): string
  dim(): number
  embed(text: string): number[]
  embedBatch(texts: string[]): number[][]
  /** 遥测/统计(可选)。 */
  telemetry?(): Record<string, number | string>
  healthCheck(opts?: { probe?: boolean }): EmbeddingHealth
  isDegraded(): boolean
  strict(): boolean
  allowCpuFallback(): boolean
}

export interface EmbeddingResult {
  vector: number[]
  model: string
  degraded: boolean
}

/**
 * Batch F(spec §6):数据控制谓词。
 *
 * 记忆数据是否可外发用于"模型改进"或"模型训练"。默认全关 = 零外发。
 * 仅控制上报/外发;本地记忆能力(retrieval/extract/dream)不受影响。
 */
export type ReportPurpose = 'improvement' | 'training'

export interface DataControlSettings {
  allowModelImprovement: boolean
  allowTraining: boolean
}

/** Batch F:某用途能否外发记忆数据?相关开关关 → 拒绝(零外发)。 */
export function canReportMemoryData(settings: DataControlSettings, purpose: ReportPurpose): boolean {
  if (purpose === 'training') return settings.allowTraining === true
  return settings.allowModelImprovement === true
}

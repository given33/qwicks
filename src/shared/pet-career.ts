/**
 * 桌面宠物 —— 教育与打工系统（P3，QQ 人生成长线）。
 *
 * 三维属性：智力/魅力/武力。学历阶梯 7 级（幼儿园→博士），职业阶梯 8 级。
 * 学习消耗时间+心情提升属性；打工消耗体力换元宝，属性/学历达标解锁高薪职业。
 *
 * QQ 的"人生感"核心：宠物有社会身份（学历+职业），不只是数值。
 */

/** 三维属性 */
export type CareerStats = {
  intelligence: number  // 智力
  charm: number          // 魅力
  strength: number       // 武力
}

/** 学历阶梯（参考 QQ 幼儿园→大学→考研） */
export type EducationLevel =
  | 'kindergarten' | 'primary' | 'middle' | 'high' | 'college' | 'master' | 'phd'

export const EDUCATION_LEVELS: { id: EducationLevel; name: string; statBoost: Partial<CareerStats>; cost: { mood: number; minutes: number }; requirement?: Partial<CareerStats> }[] = [
  { id: 'kindergarten', name: '幼儿园', statBoost: { intelligence: 5, charm: 5 }, cost: { mood: 5, minutes: 5 } },
  { id: 'primary', name: '小学', statBoost: { intelligence: 10, strength: 5 }, cost: { mood: 8, minutes: 15 }, requirement: { intelligence: 5 } },
  { id: 'middle', name: '初中', statBoost: { intelligence: 15, charm: 5 }, cost: { mood: 10, minutes: 30 }, requirement: { intelligence: 15 } },
  { id: 'high', name: '高中', statBoost: { intelligence: 20, strength: 10 }, cost: { mood: 12, minutes: 60 }, requirement: { intelligence: 30 } },
  { id: 'college', name: '大学', statBoost: { intelligence: 30, charm: 20 }, cost: { mood: 15, minutes: 120 }, requirement: { intelligence: 50 } },
  { id: 'master', name: '硕士', statBoost: { intelligence: 40, charm: 15 }, cost: { mood: 18, minutes: 180 }, requirement: { intelligence: 80 } },
  { id: 'phd', name: '博士', statBoost: { intelligence: 50, charm: 20, strength: 10 }, cost: { mood: 20, minutes: 300 }, requirement: { intelligence: 120 } }
]

/** 职业阶梯（参考 QQ 建筑工→医生→总裁） */
export type JobId =
  | 'cleaner' | 'builder' | 'delivery' | 'cashier' | 'teacher' | 'engineer' | 'doctor' | 'ceo'

export const JOBS: {
  id: JobId; name: string; emoji: string; salary: number; fatigue: number
  requirement: { education?: EducationLevel; stats?: Partial<CareerStats> }
}[] = [
  { id: 'cleaner', name: '清洁工', emoji: '🧹', salary: 15, fatigue: 10, requirement: {} },
  { id: 'builder', name: '建筑工', emoji: '👷', salary: 25, fatigue: 15, requirement: { stats: { strength: 10 } } },
  { id: 'delivery', name: '快递员', emoji: '📦', salary: 30, fatigue: 12, requirement: { stats: { strength: 20 } } },
  { id: 'cashier', name: '收银员', emoji: '💰', salary: 35, fatigue: 8, requirement: { education: 'middle' } },
  { id: 'teacher', name: '教师', emoji: '👩‍🏫', salary: 60, fatigue: 10, requirement: { education: 'college' } },
  { id: 'engineer', name: '工程师', emoji: '⚙️', salary: 90, fatigue: 12, requirement: { education: 'college', stats: { intelligence: 80 } } },
  { id: 'doctor', name: '医生', emoji: '👨‍⚕️', salary: 130, fatigue: 15, requirement: { education: 'master' } },
  { id: 'ceo', name: '总裁', emoji: '💼', salary: 250, fatigue: 20, requirement: { education: 'master', stats: { intelligence: 150, charm: 80 } } }
]

export type CareerState = {
  stats: CareerStats
  education: EducationLevel | null  // null=未入学
  currentJob: JobId | null
}

export function defaultCareer(): CareerState {
  return {
    stats: { intelligence: 0, charm: 0, strength: 0 },
    education: null,
    currentJob: null
  }
}

/** 判定能否就读某学历（需前置学历+属性达标）。 */
export function canEnroll(career: CareerState, level: EducationLevel): { ok: boolean; reason?: string } {
  const def = EDUCATION_LEVELS.find((e) => e.id === level)
  if (!def) return { ok: false, reason: '未知学历' }
  if (career.education === level) return { ok: false, reason: '已就读' }
  // 前置：当前学历必须是前一级
  const idx = EDUCATION_LEVELS.findIndex((e) => e.id === level)
  if (idx > 0) {
    const prev = EDUCATION_LEVELS[idx - 1].id
    if (career.education !== prev) return { ok: false, reason: `需先完成${EDUCATION_LEVELS[idx - 1].name}` }
  }
  // 属性要求
  if (def.requirement) {
    for (const [k, v] of Object.entries(def.requirement)) {
      if ((career.stats[k as keyof CareerStats] ?? 0) < (v ?? 0)) {
        return { ok: false, reason: `${k} 不足` }
      }
    }
  }
  return { ok: true }
}

/** 完成学习：提升属性 + 设学历。返回新 career。 */
export function completeEducation(career: CareerState, level: EducationLevel): CareerState {
  const def = EDUCATION_LEVELS.find((e) => e.id === level)
  if (!def) return career
  return {
    ...career,
    stats: {
      intelligence: career.stats.intelligence + (def.statBoost.intelligence ?? 0),
      charm: career.stats.charm + (def.statBoost.charm ?? 0),
      strength: career.stats.strength + (def.statBoost.strength ?? 0)
    },
    education: level
  }
}

/** 判定能否任职某工作。 */
export function canWork(career: CareerState, job: JobId): { ok: boolean; reason?: string } {
  const def = JOBS.find((j) => j.id === job)
  if (!def) return { ok: false, reason: '未知职业' }
  if (def.requirement.education && career.education !== def.requirement.education) {
    const eduName = EDUCATION_LEVELS.find((e) => e.id === def.requirement.education)?.name ?? '学历'
    return { ok: false, reason: `需${eduName}学历` }
  }
  if (def.requirement.stats) {
    for (const [k, v] of Object.entries(def.requirement.stats)) {
      if ((career.stats[k as keyof CareerStats] ?? 0) < (v ?? 0)) {
        return { ok: false, reason: `${k}不足` }
      }
    }
  }
  return { ok: true }
}

/** 打工结算：得元宝，扣心情（疲劳）。返回 { coins, moodDelta }。 */
export function workReward(job: JobId): { coins: number; moodDelta: number } {
  const def = JOBS.find((j) => j.id === job)
  if (!def) return { coins: 0, moodDelta: 0 }
  return { coins: def.salary, moodDelta: -def.fatigue }
}

/** 学历中文名 */
export function educationName(level: EducationLevel | null): string {
  if (!level) return '未入学'
  return EDUCATION_LEVELS.find((e) => e.id === level)?.name ?? '未知'
}

/** 当前可解锁的最高职业（展示用） */
export function highestEligibleJob(career: CareerState): JobId {
  for (let i = JOBS.length - 1; i >= 0; i -= 1) {
    if (canWork(career, JOBS[i].id).ok) return JOBS[i].id
  }
  return 'cleaner'
}

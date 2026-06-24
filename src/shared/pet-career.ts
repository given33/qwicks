/**
 * 桌面宠物 —— 教育与职业系统（2026 中国现实版，P3 扩展）。
 *
 * 教育路径贴近 2026 中国：幼儿园→小学→初中（9年义务）→普高/职高分流→
 * 大学/大专→硕士→博士。职高与普高并行，分流后路径不同。
 *
 * 职业贴近 2026 中国：外卖骑手、网约车、快递员、程序员、AI工程师、
 * 医生、公务员、教师、博主/主播、金融、设计师、电商运营等。
 *
 * 强挂钩：
 *   - 高学历（大学+）解锁白领（程序员/医生/公务员/AI工程师）
 *   - 高体力解锁蓝领高薪（外卖骑手月入过万、网约车）
 *   - 职高路径偏向技能岗（厨师/汽修/电商运营）
 *   - 高魅力解锁主播/博主/销售（流量变现）
 */

/** 三维属性 */
export type CareerStats = {
  intelligence: number  // 智力（影响学历+脑力职业）
  charm: number          // 魅力（影响流量类职业）
  strength: number       // 体力（影响蓝领职业收入）
}

// ===== 教育系统（2026 中国）=====

export type EducationLevel =
  | 'kindergarten'   // 幼儿园
  | 'primary'        // 小学
  | 'middle'         // 初中（9年义务结束）
  // 分流点：普高 or 职高
  | 'high'           // 普通高中
  | 'vocational'     // 职业高中
  // 高等教育
  | 'college'        // 大学本科
  | 'associate'      // 大专（职高路径）
  | 'master'         // 硕士
  | 'phd'            // 博士

export type EducationDef = {
  id: EducationLevel
  name: string
  statBoost: Partial<CareerStats>
  cost: { mood: number; minutes: number }
  /** 前置学历（必须完成才能就读） */
  prereq?: EducationLevel
  /** 替代前置（分流点：普高/职高二选一） */
  altPrereq?: EducationLevel
  /** 属性要求 */
  requirement?: Partial<CareerStats>
}

export const EDUCATION_LEVELS: EducationDef[] = [
  { id: 'kindergarten', name: '幼儿园', statBoost: { intelligence: 5, charm: 5, strength: 5 }, cost: { mood: 5, minutes: 5 } },
  { id: 'primary', name: '小学', statBoost: { intelligence: 10, strength: 5 }, cost: { mood: 8, minutes: 15 }, prereq: 'kindergarten' },
  { id: 'middle', name: '初中', statBoost: { intelligence: 15, charm: 5, strength: 8 }, cost: { mood: 10, minutes: 30 }, prereq: 'primary' },
  // 分流：普高（偏智力，通往大学）vs 职高（偏体力/技能，通往大专/技能岗）
  { id: 'high', name: '普通高中', statBoost: { intelligence: 25, charm: 5 }, cost: { mood: 14, minutes: 60 }, prereq: 'middle', requirement: { intelligence: 30 } },
  { id: 'vocational', name: '职业高中', statBoost: { strength: 20, charm: 8, intelligence: 8 }, cost: { mood: 10, minutes: 45 }, prereq: 'middle' },
  // 高等教育
  { id: 'college', name: '大学本科', statBoost: { intelligence: 40, charm: 20 }, cost: { mood: 16, minutes: 120 }, prereq: 'high', requirement: { intelligence: 55 } },
  { id: 'associate', name: '大专', statBoost: { intelligence: 20, strength: 15, charm: 10 }, cost: { mood: 12, minutes: 75 }, prereq: 'vocational' },
  { id: 'master', name: '硕士研究生', statBoost: { intelligence: 50, charm: 15 }, cost: { mood: 18, minutes: 180 }, prereq: 'college', requirement: { intelligence: 95 } },
  { id: 'phd', name: '博士研究生', statBoost: { intelligence: 70, charm: 10, strength: 5 }, cost: { mood: 22, minutes: 300 }, prereq: 'master', requirement: { intelligence: 145 } }
]

// ===== 职业系统（2026 中国）=====

export type JobCategory = 'blue-collar' | 'service' | 'skill' | 'white-collar' | 'tech' | 'medical' | 'civil' | 'creative' | 'finance' | 'elite'

export type JobId =
  // 蓝领（体力向，低学历高收入）
  | 'construction' | 'factory' | 'logistics-worker'
  // 服务业（新业态）
  | 'delivery' | 'ride-hailing' | 'courier' | 'cashier' | 'waiter'
  // 技能岗（职高路径）
  | 'chef' | 'mechanic' | 'beautician' | 'ecommerce-ops'
  // 白领（学历向）
  | 'clerk' | 'hr' | 'teacher' | 'accountant'
  // 科技（高学历+智力）
  | 'programmer' | 'ai-engineer' | 'data-analyst' | 'product-manager'
  // 医疗（高学历）
  | 'nurse' | 'doctor' | 'pharmacist'
  // 公务员/体制内
  | 'civil-servant' | 'bank-clerk'
  // 创意/流量（魅力向）
  | 'streamer' | 'blogger' | 'designer' | 'writer'
  // 金融（高学历+智力）
  | 'banker' | 'analyst' | 'insurance'
  // 顶尖
  | 'ceo' | 'professor' | 'scientist'

export type JobDef = {
  id: JobId
  name: string
  emoji: string
  category: JobCategory
  /** 时薪（元宝/次打工） */
  salary: number
  /** 疲劳（扣心情） */
  fatigue: number
  /** 解锁条件 */
  requirement: {
    education?: EducationLevel
    /** 满足任一即可（多学历路径） */
    educationAny?: EducationLevel[]
    stats?: Partial<CareerStats>
  }
}

export const JOBS: JobDef[] = [
  // 蓝领（体力向）
  { id: 'construction', name: '建筑工', emoji: '👷', category: 'blue-collar', salary: 30, fatigue: 18, requirement: { stats: { strength: 15 } } },
  { id: 'factory', name: '工厂普工', emoji: '🏭', category: 'blue-collar', salary: 22, fatigue: 15, requirement: {} },
  { id: 'logistics-worker', name: '物流分拣', emoji: '📦', category: 'blue-collar', salary: 28, fatigue: 16, requirement: { stats: { strength: 20 } } },

  // 服务业新业态（体力向，月入可观）
  { id: 'delivery', name: '外卖骑手', emoji: '🛵', category: 'service', salary: 45, fatigue: 18, requirement: { stats: { strength: 25 } } },
  { id: 'ride-hailing', name: '网约车司机', emoji: '🚗', category: 'service', salary: 50, fatigue: 15, requirement: { stats: { strength: 20 }, educationAny: ['middle', 'high', 'vocational'] } },
  { id: 'courier', name: '快递员', emoji: '📮', category: 'service', salary: 40, fatigue: 17, requirement: { stats: { strength: 22 } } },
  { id: 'cashier', name: '收银员', emoji: '🧾', category: 'service', salary: 25, fatigue: 8, requirement: { educationAny: ['middle', 'high', 'vocational'] } },
  { id: 'waiter', name: '服务员', emoji: '🍽️', category: 'service', salary: 20, fatigue: 12, requirement: {} },

  // 技能岗（职高路径）
  { id: 'chef', name: '厨师', emoji: '👨‍🍳', category: 'skill', salary: 55, fatigue: 14, requirement: { educationAny: ['vocational', 'associate'], stats: { strength: 15 } } },
  { id: 'mechanic', name: '汽修技师', emoji: '🔧', category: 'skill', salary: 48, fatigue: 15, requirement: { educationAny: ['vocational', 'associate'], stats: { strength: 18 } } },
  { id: 'beautician', name: '美容师', emoji: '💅', category: 'skill', salary: 42, fatigue: 10, requirement: { educationAny: ['vocational', 'associate'], stats: { charm: 20 } } },
  { id: 'ecommerce-ops', name: '电商运营', emoji: '🛒', category: 'skill', salary: 60, fatigue: 12, requirement: { educationAny: ['vocational', 'associate', 'college'] } },

  // 白领
  { id: 'clerk', name: '文员', emoji: '📋', category: 'white-collar', salary: 35, fatigue: 8, requirement: { educationAny: ['associate', 'college'] } },
  { id: 'hr', name: 'HR人事', emoji: '🧑‍💼', category: 'white-collar', salary: 50, fatigue: 10, requirement: { educationAny: ['college'], stats: { charm: 30 } } },
  { id: 'teacher', name: '教师', emoji: '👩‍🏫', category: 'white-collar', salary: 65, fatigue: 11, requirement: { education: 'college', stats: { intelligence: 80 } } },
  { id: 'accountant', name: '会计', emoji: '🧮', category: 'white-collar', salary: 55, fatigue: 10, requirement: { educationAny: ['associate', 'college'], stats: { intelligence: 60 } } },

  // 科技（高智力）
  { id: 'programmer', name: '程序员', emoji: '👨‍💻', category: 'tech', salary: 110, fatigue: 14, requirement: { educationAny: ['college', 'master'], stats: { intelligence: 100 } } },
  { id: 'ai-engineer', name: 'AI工程师', emoji: '🤖', category: 'tech', salary: 180, fatigue: 16, requirement: { educationAny: ['master', 'phd'], stats: { intelligence: 150 } } },
  { id: 'data-analyst', name: '数据分析师', emoji: '📊', category: 'tech', salary: 120, fatigue: 12, requirement: { educationAny: ['college', 'master'], stats: { intelligence: 110 } } },
  { id: 'product-manager', name: '产品经理', emoji: '📐', category: 'tech', salary: 130, fatigue: 13, requirement: { educationAny: ['college', 'master'], stats: { intelligence: 90, charm: 40 } } },

  // 医疗
  { id: 'nurse', name: '护士', emoji: '👩‍⚕️', category: 'medical', salary: 60, fatigue: 15, requirement: { educationAny: ['associate', 'college'], stats: { strength: 20, charm: 30 } } },
  { id: 'doctor', name: '医生', emoji: '👨‍⚕️', category: 'medical', salary: 160, fatigue: 18, requirement: { education: 'master', stats: { intelligence: 130 } } },
  { id: 'pharmacist', name: '药剂师', emoji: '💊', category: 'medical', salary: 90, fatigue: 10, requirement: { educationAny: ['college', 'master'], stats: { intelligence: 90 } } },

  // 体制内
  { id: 'civil-servant', name: '公务员', emoji: '🏛️', category: 'civil', salary: 85, fatigue: 10, requirement: { educationAny: ['college', 'master'], stats: { intelligence: 80, charm: 40 } } },
  { id: 'bank-clerk', name: '银行职员', emoji: '🏦', category: 'civil', salary: 75, fatigue: 11, requirement: { educationAny: ['college'], stats: { intelligence: 70, charm: 35 } } },

  // 创意/流量（魅力向，低学历也能高收入）
  { id: 'streamer', name: '主播', emoji: '🎤', category: 'creative', salary: 100, fatigue: 12, requirement: { stats: { charm: 60 } } },
  { id: 'blogger', name: '博主', emoji: '📸', category: 'creative', salary: 85, fatigue: 10, requirement: { stats: { charm: 50, intelligence: 40 } } },
  { id: 'designer', name: '设计师', emoji: '🎨', category: 'creative', salary: 80, fatigue: 11, requirement: { educationAny: ['associate', 'college', 'master'], stats: { charm: 40, intelligence: 60 } } },
  { id: 'writer', name: '编剧/作家', emoji: '✍️', category: 'creative', salary: 70, fatigue: 9, requirement: { stats: { intelligence: 80, charm: 30 } } },

  // 金融
  { id: 'banker', name: '投行经理', emoji: '💼', category: 'finance', salary: 200, fatigue: 18, requirement: { educationAny: ['master', 'phd'], stats: { intelligence: 140, charm: 60 } } },
  { id: 'analyst', name: '金融分析师', emoji: '📈', category: 'finance', salary: 150, fatigue: 14, requirement: { educationAny: ['master'], stats: { intelligence: 120 } } },
  { id: 'insurance', name: '保险经纪', emoji: '🛡️', category: 'finance', salary: 60, fatigue: 12, requirement: { educationAny: ['associate', 'college'], stats: { charm: 50 } } },

  // 顶尖
  { id: 'ceo', name: 'CEO总裁', emoji: '👑', category: 'elite', salary: 300, fatigue: 20, requirement: { education: 'master', stats: { intelligence: 160, charm: 80, strength: 30 } } },
  { id: 'professor', name: '大学教授', emoji: '🎓', category: 'elite', salary: 140, fatigue: 12, requirement: { education: 'phd', stats: { intelligence: 180 } } },
  { id: 'scientist', name: '科学家', emoji: '🔬', category: 'elite', salary: 220, fatigue: 16, requirement: { education: 'phd', stats: { intelligence: 200 } } }
]

export type CareerState = {
  stats: CareerStats
  education: EducationLevel | null
  currentJob: JobId | null
}

export function defaultCareer(): CareerState {
  return { stats: { intelligence: 0, charm: 0, strength: 0 }, education: null, currentJob: null }
}

/** 判定能否就读（前置/分流/属性）。 */
export function canEnroll(career: CareerState, level: EducationLevel): { ok: boolean; reason?: string } {
  const def = EDUCATION_LEVELS.find((e) => e.id === level)
  if (!def) return { ok: false, reason: '未知学历' }
  if (career.education === level) return { ok: false, reason: '已完成' }
  // 前置：prereq 或 altPrereq（分流点普高/职高，完成任一即可进后续）
  if (def.prereq || def.altPrereq) {
    const ok = career.education === def.prereq || career.education === def.altPrereq
    if (!ok) {
      const need = [def.prereq, def.altPrereq].filter(Boolean).map((l) => EDUCATION_LEVELS.find((e) => e.id === l)?.name).join('或')
      return { ok: false, reason: `需先完成${need}` }
    }
  }
  if (def.requirement) {
    for (const [k, v] of Object.entries(def.requirement)) {
      if ((career.stats[k as keyof CareerStats] ?? 0) < (v ?? 0)) {
        return { ok: false, reason: `${statName(k as keyof CareerStats)}不足（需${v}）` }
      }
    }
  }
  return { ok: true }
}

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

/** 判定能否任职。支持 education 单一 或 educationAny 多选 + stats 门槛。 */
export function canWork(career: CareerState, job: JobId): { ok: boolean; reason?: string } {
  const def = JOBS.find((j) => j.id === job)
  if (!def) return { ok: false, reason: '未知职业' }
  const r = def.requirement
  // 学历：单一或任一
  if (r.education && career.education !== r.education) {
    return { ok: false, reason: `需${educationName(r.education)}学历` }
  }
  if (r.educationAny && !r.educationAny.includes(career.education as EducationLevel)) {
    return { ok: false, reason: `需${r.educationAny.map((l) => educationName(l)).join('/')}` }
  }
  if (r.stats) {
    for (const [k, v] of Object.entries(r.stats)) {
      if ((career.stats[k as keyof CareerStats] ?? 0) < (v ?? 0)) {
        return { ok: false, reason: `${statName(k as keyof CareerStats)}不足（需${v}）` }
      }
    }
  }
  return { ok: true }
}

export function workReward(job: JobId): { coins: number; moodDelta: number } {
  const def = JOBS.find((j) => j.id === job)
  if (!def) return { coins: 0, moodDelta: 0 }
  return { coins: def.salary, moodDelta: -def.fatigue }
}

export function educationName(level: EducationLevel | null): string {
  if (!level) return '未入学'
  return EDUCATION_LEVELS.find((e) => e.id === level)?.name ?? '未知'
}

export function statName(s: keyof CareerStats): string {
  return s === 'intelligence' ? '智力' : s === 'charm' ? '魅力' : '体力'
}

/** 当前可解锁的最高薪职业（展示用） */
export function highestEligibleJob(career: CareerState): JobId {
  const eligible = JOBS.filter((j) => canWork(career, j.id).ok)
  if (eligible.length === 0) return 'waiter'
  return eligible.sort((a, b) => b.salary - a.salary)[0]!.id
}

/** 职业分类中文名（UI 分组） */
export const JOB_CATEGORY_NAMES: Record<JobCategory, string> = {
  'blue-collar': '蓝领', service: '服务业', skill: '技能岗',
  'white-collar': '白领', tech: '科技互联网', medical: '医疗',
  civil: '体制内', creative: '创意/流量', finance: '金融', elite: '顶尖'
}

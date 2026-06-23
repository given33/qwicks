/**
 * HeuristicExtractor —— 零依赖启发式回退(1:1 对齐 Python `dream/extraction/base.py`)。
 *
 * 规则:
 *  - 显式偏好("我喜欢"/"I prefer") → preference
 *  - 目标("我想做"/"I want to") → goal
 *  - 技能("我会"/"I know") → skill
 *  - 约束("必须"/"must") → constraint
 *  - 项目("我的项目"/"I'm building") → project
 *  - 反馈("我觉得"/"I think") → feedback
 *  - 其他 → fact
 * assistant 句子里有用的 → episode
 *
 * 句子切分保护英文缩写词,且 200+ 长句在连接词上再切(对齐 Python _split_sentences)。
 */
import {
  MemoryItemDraft,
  MemoryProvenance,
  MemoryType,
  MemoryType as MT
} from '../types.js'
import type { ExtractInput, Extractor } from './base.js'

type PatternList = ReadonlyArray<readonly [MT, readonly RegExp[]]>

// 对齐 Python PATTERNS(忽略大小写)
const PATTERNS: PatternList = [
  [
    MemoryType.PREFERENCE,
    [
      /我(?:喜欢|不喜欢|更倾向|偏向|总是|从不|会|不会|prefer(?:red)?s?)/,
      /(?:always use|never use|i (?:like|love|prefer|hate)|my favorite|不喜欢)/i,
      /(?:i enjoy|i'm into|i tend to|i'd rather|i would rather|prefer to|prefers?\s+to)/i,
      /(?:keep\s+(?:it|replies|responses|answers)|no\s+(?:marketing|fluff|bs|nonsense))/i
    ]
  ],
  [
    MemoryType.GOAL,
    [
      /我(?:想|计划|打算|目标|希望|要)/,
      /我(?:的)?(?:目标|计划|打算)/,
      /(?:i (?:want|plan|hope|aim|intend)|my goal|objective)/i,
      /(?:i'd like to|i'm trying to|my aim is|target is|goal is)/i
    ]
  ],
  [
    MemoryType.SKILL,
    [
      /我(?:会|熟悉|掌握|了解|精通|擅长)/,
      /(?:i (?:know|am familiar with|master)|i have experience with|skill in)/i,
      /(?:i'm proficient in|i've worked with|i use|my stack|tech stack)/i
    ]
  ],
  [
    MemoryType.PROJECT,
    [
      /我的项目|我在做|正在做|负责的项目|现在做/,
      /(?:my project|i am working on|building a|i'm building|i am building)/i,
      /(?:i'm developing|my current project|working on a|we're building)/i
    ]
  ],
  [
    MemoryType.CONSTRAINT,
    [
      /必须|不能|禁止|务必|一定要|不允许/,
      /(?:must not|cannot|prohibit|required|forbidden)/i,
      /(?:must|can't|cannot|shouldn't|need to|have to|not allowed|it's important that)/i
    ]
  ],
  [
    MemoryType.FEEDBACK,
    [
      /反馈|建议|意见|觉得|感觉/,
      /(?:feedback|suggestion|i think|i feel|comment)/i,
      /(?:my opinion|in my experience|i'd say|i noticed|i've noticed)/i
    ]
  ]
]

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc',
  'e.g', 'i.e', 'approx', 'dept', 'est', 'govt', 'corp',
  'inc', 'ltd', 'co', 'ph.d', 'm.d', 'a.m', 'p.m'
])

const TOPIC_KEYWORDS = ['机器人', 'robot', 'path', 'planner', 'rl', 'llm', 'agent', 'memory', 'go', 'rust', 'python']

const PRODUCT_ATTRS: ReadonlyArray<readonly [string, RegExp]> = [
  ['priority', /p0|p1|p2|p3|优先级|最重要|critical|urgent/i],
  ['target_user', /(?:for|target|对)\s*(?:developers?|devs|users?|用户|devs|ops|enterprise)/i],
  ['privacy_stance', /local.first|no.cloud|air.gapped|offline|隐私|privacy|on.prem/i],
  ['rollout_plan', /v1|v2|v3|phase\s*[123]|milestone|alpha|beta|ga|launch/i],
  ['v1_v2_split', /v1.*v2|phase\s*1.*phase\s*2|先.*后|first.*then/i]
]

export class HeuristicExtractor implements Extractor {
  static readonly NAME = 'dream.heuristic.v1'

  name(): string {
    return HeuristicExtractor.NAME
  }

  extract(input: ExtractInput): MemoryItemDraft[] {
    const drafts: MemoryItemDraft[] = []
    for (const sentence of this.splitSentences(input.user)) {
      const s = sentence.trim()
      if (!s || s.length < 4) continue
      // 跳过问句(用户在提问,不是在陈述事实/偏好 —— 不应存为记忆)。
      if (this.isQuestion(s)) continue
      let matched: MT | null = null
      for (const [type, patterns] of PATTERNS) {
        if (patterns.some((p) => p.test(s))) {
          matched = type
          break
        }
      }
      if (matched) {
        drafts.push(this.draft(matched, s, this.importance(matched), 0.65))
      } else if (this.looksLikeFact(s)) {
        drafts.push(this.draft(MemoryType.FACT, s, 0.4, 0.55))
      }
    }
    if (input.assistant) {
      for (const s of this.splitSentences(input.assistant)) {
        const t = s.trim()
        if (this.isUsefulEpisode(t)) {
          drafts.push(
            new MemoryItemDraft(
              MemoryType.EPISODE,
              t,
              [],
              0.3,
              0.4,
              undefined,
              new MemoryProvenance('model', null, null, null, 0.4, this.name()),
              { method: 'heuristic', matched_type: 'episode', role: 'assistant' }
            )
          )
        }
      }
    }
    return drafts
  }

  private draft(type: MT, content: string, importance: number, confidence: number): MemoryItemDraft {
    return new MemoryItemDraft(
      type,
      content,
      this.tags(content, type),
      importance,
      confidence,
      undefined,
      new MemoryProvenance('model', null, null, null, confidence, this.name()),
      { method: 'heuristic', matched_type: type }
    )
  }

  private importance(type: MT): number {
    if (type === MT.GOAL || type === MT.SKILL || type === MT.PREFERENCE) return 0.7
    if (type === MT.CONSTRAINT) return 0.65
    if (type === MT.PROJECT) return 0.6
    return 0.5
  }

  /** 问句检测:以问号结尾,或以疑问词开头(what/how/why/which/who/when/where/是否/怎么/什么/为什么)。 */
  private isQuestion(s: string): boolean {
    if (s.endsWith('?') || s.endsWith('？')) return true
    return /^(?:what|how|why|which|who|when|where|can you|could you|do you|is it|are you|tell me|show me|remind me|什么|怎么|为什么|哪些|哪个|是否|能否|请问)/i.test(s.trim())
  }

  private tags(s: string, type: MT): string[] {
    const tags: string[] = [type]
    const low = s.toLowerCase()
    for (const kw of TOPIC_KEYWORDS) if (low.includes(kw)) tags.push(kw)
    for (const [attr, pat] of PRODUCT_ATTRS) if (pat.test(low)) tags.push(`product:${attr}`)
    return tags
  }

  private looksLikeFact(s: string): boolean {
    return s.length >= 4 && s.length <= 200 && /[a-z0-9]/i.test(s)
  }

  private isUsefulEpisode(s: string): boolean {
    if (s.length < 8 || s.length > 200) return false
    return !/^(sure|ok|okay|好的|嗯)/i.test(s)
  }

  private splitSentences(text: string): string[] {
    // 对齐 Python _split_sentences:缩写词保护 + 句末标点切分 + 连接词再切。
    let t = text
    for (const abbr of ABBREV) {
      t = t.replace(new RegExp(`${escapeRe(abbr)}\\.`, 'g'), abbr.replace(/\./g, '<DOT>'))
    }
    t = t.replace(/\n/g, '. ')
    // 句末标点 . ! ? ; 。 ！ ？ ；(不切数字间的 .,如 URL/IP)
    t = t.replace(/(?<!\d)([。！？!?；;.]){1,3}(?!\d)/g, '$1<split>')
    t = t.replace(/<split>+/g, '<split>')
    t = t.replace(/<DOT>/g, '.')
    const parts = t.split('<split>').map((p) => p.trim()).filter(Boolean)
    const out: string[] = []
    const connector = /[,;]\s+(?:and|but|so|because|however|therefore|then|also|hence|thus|meanwhile)\s+/i
    for (const part of parts) {
      if (part.length > 200) {
        for (const sub of part.split(connector)) {
          const t2 = sub.trim()
          if (t2) out.push(t2)
        }
      } else {
        out.push(part)
      }
    }
    return out
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

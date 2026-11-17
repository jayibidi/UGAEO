/**
 * 按平台规则适配标题（确定性部分）
 *
 * 这里做的是「不需要模型也能做对」的事：数长度、按标点断句、去掉平台不吃的符号、
 * 标题为空时从正文首句取。AI 改写是另一层（`title-strategy.ts`），
 * 它负责「超长之后换个说法」而不是硬切。
 */
import type { PlatformPublishRule } from './platform-rules'

export type AdaptAction =
  /** 原样可用 */
  | 'unchanged'
  /** 超长，按标点语义截断 */
  | 'truncated'
  /** 原标题为空，取正文首句 */
  | 'from-body'
  /** 去掉了平台不接受的符号（书号、emoji 等） */
  | 'stripped'

export interface TitleAdaptation {
  platformId: string
  original: string
  adapted: string
  action: AdaptAction
  /** 是否需要 AI 换个说法（超长时） */
  needsAI: boolean
  /** 给用户看的一句话说明 */
  note: string
  /** 该平台没有独立标题栏，标题要并进正文开头 */
  titleInBody?: boolean
}

/** 按码点计数：`'😀'.length === 2`，但平台按 1 个字符算 */
export function countChars(text: string): number {
  return Array.from(text || '').length
}

/** 断句符：截断优先落在这些字符后面 */
const BREAK_CHARS = new Set([
  '。', '！', '？', '；', '，', '、', '：',
  '.', '!', '?', ';', ',', ':', '—', ' ',
])

/**
 * 语义截断
 *
 * 优先在标点处断（读起来是完整的一句话），找不到标点才硬切；
 * 硬切时避开英文单词 / 数字中间，不留半个词。
 */
export function truncateTitle(title: string, max: number): string {
  const chars = Array.from(title)
  if (chars.length <= max) return title
  // 留出省略号的位置
  const budget = Math.max(1, max - 1)
  const head = chars.slice(0, budget)
  const floor = Math.floor(budget * 0.5)

  let cut = -1
  for (let i = head.length - 1; i >= floor; i--) {
    if (BREAK_CHARS.has(head[i])) {
      cut = i
      break
    }
  }

  if (cut > 0) {
    return head.slice(0, cut).join('').trimEnd() + '…'
  }

  // 没有标点：别把英文单词或数字切开
  let end = budget
  const isWordChar = (ch?: string) => !!ch && /[A-Za-z0-9]/.test(ch)
  if (isWordChar(head[end - 1]) && isWordChar(chars[end])) {
    let i = end - 1
    while (i > 0 && isWordChar(head[i])) i--
    // 退到单词边界；只有退得太多（保留不足四成）才接受硬切
    if (i >= Math.max(4, Math.floor(budget * 0.4))) end = i
  }
  return chars.slice(0, end).join('').trimEnd() + '…'
}

/** 从正文里捞一句能当标题的话 */
export function titleFromBody(bodyText: string, max: number): string {
  const text = (bodyText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  const sentences = text.split(/[。！？!?\n]/).map(s => s.trim()).filter(Boolean)
  const picked = sentences.find(s => countChars(s) >= 6) || sentences[0] || text
  return truncateTitle(picked, max)
}

/** 平台允许的最长标题：有硬上限用硬上限，否则用「建议区间」的上界 */
export function effectiveTitleMax(rule: PlatformPublishRule): number | undefined {
  if (rule.titleMax) return rule.titleMax
  if (rule.titleIdeal) return rule.titleIdeal[1]
  return undefined
}

/**
 * 出一份「这个平台的标题该怎么改」
 *
 * 注意这里已经先截断了（保证「就算 AI 不可用也能发出去」），
 * 但 `needsAI` 会告诉上层：这个标题原本超长，值得找模型换个说法。
 */
export function adaptTitle(
  platformId: string,
  title: string,
  bodyText: string,
  rule: PlatformPublishRule
): TitleAdaptation {
  const original = (title || '').trim()
  const limit = effectiveTitleMax(rule)

  // 1) 标题为空 → 从正文取首句
  if (!original) {
    const fallback = titleFromBody(bodyText, limit || 30)
    return {
      platformId,
      original: '',
      adapted: fallback,
      action: fallback ? 'from-body' : 'unchanged',
      needsAI: false,
      note: fallback ? '原标题为空，取正文首句' : '标题为空且正文没取到可用句子',
      titleInBody: rule.titleInBody,
    }
  }

  let working = original
  let action: AdaptAction = 'unchanged'
  let note = ''

  // 2) 平台不接受的符号
  if (rule.titleForbidden) {
    try {
      const stripped = working.replace(new RegExp(rule.titleForbidden, 'g'), '').replace(/\s{2,}/g, ' ').trim()
      if (stripped && stripped !== working) {
        working = stripped
        action = 'stripped'
        note = '去掉了该平台不接受的符号'
      }
    } catch {
      // 规则写错了不该阻断同步
    }
  }

  // 3) 超长 → 先截（AI 可用时上层会用改写结果覆盖）
  if (limit && countChars(working) > limit) {
    const before = countChars(working)
    working = truncateTitle(working, limit)
    return {
      platformId,
      original,
      adapted: working,
      action: 'truncated',
      needsAI: true,
      note: note ? `${note}；标题 ${before} → ${countChars(working)} 字` : `标题 ${before} → ${countChars(working)} 字`,
      titleInBody: rule.titleInBody,
    }
  }

  return {
    platformId,
    original,
    adapted: working,
    action,
    needsAI: false,
    note,
    titleInBody: rule.titleInBody,
  }
}

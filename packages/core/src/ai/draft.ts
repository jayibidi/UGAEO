/**
 * 从「标题 / 一句话提示词」直接生成整篇稿子
 *
 * 与 publish-brief 的区别：
 *   - publish-brief 是「已有正文，按平台收敛标题/摘要/标签」；
 *   - draft 是「还没有正文，从零写一篇」——标题、摘要、标签、正文一次产出。
 *
 * 编辑器里的 AI 文案框走的是这条路：用户可能只输入一个标题，也可能输入
 * 「写一篇关于 XX 的科普，面向新手」，模型得自己决定结构。
 */
import { extractJSON } from './client'

export type DraftLength = 'short' | 'medium' | 'long'

export interface DraftInput {
  /** 用户输入：标题，或描述想要的稿子 */
  prompt: string
  /** 期望篇幅，默认 medium */
  length?: DraftLength
  /** 已经填了标题时一并给模型，避免它另起一个不相关的标题 */
  title?: string
}

export interface DraftResult {
  title: string
  summary: string
  tags: string[]
  /** Markdown 正文 */
  markdown: string
}

const LENGTH_SPEC: Record<DraftLength, string> = {
  short: '600~900 字，3~4 个小节',
  medium: '1200~1600 字，4~6 个小节',
  long: '2000~2600 字，6~8 个小节',
}

export function draftPrompt(input: DraftInput): string {
  const spec = LENGTH_SPEC[input.length || 'medium']
  return `你是资深中文新媒体编辑，请根据下面的输入写一篇可以直接发布的中文文章。

【用户输入】
${input.prompt.trim()}
${input.title?.trim() ? `\n【已有标题，请沿用或只做小幅优化】\n${input.title.trim()}\n` : ''}
【硬性要求】
1. 标题：不超过 30 字，具体、有信息量，不要「震惊体」「标题党」。
2. 摘要：60~100 字，能独立成段，说清这篇讲了什么、读者能得到什么。
3. 标签：3~5 个，2~8 个字，不带 # 号，不要和标题重复。
4. 正文：Markdown 格式，篇幅 ${spec}；小节用 \`##\`，段落短（2~4 行），
   关键结论可用列表；不要写「作为一名 AI」「本文将」这类套话；
   不要编造具体数据、人名、机构名与引用，需要举例就用通用描述。
5. 如果用户输入的是一个明确的标题，就围绕它写；如果是开放描述，先自己定一个好标题再写。

【输出格式】只输出 JSON，不要任何解释、不要代码块标记：
{"title":"标题","summary":"摘要","tags":["标签1","标签2"],"markdown":"## 小节\\n\\n正文……"}`
}

function asTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、\s]+/)
      : []
  return raw
    .map(item => String(item).replace(/^#+/, '').trim())
    .filter(item => item.length >= 1 && item.length <= 16)
    .slice(0, 6)
}

function firstHeading(markdown: string): string {
  const match = markdown.match(/^\s*#{1,2}\s+(.+)$/m)
  return match ? match[1].trim() : ''
}

function plainSummary(markdown: string, max = 100): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * 解析模型输出
 *
 * 模型偶尔会无视 JSON 要求直接吐 Markdown —— 这种情况不当作失败：
 * 正文照用，标题从一级/二级标题里取，摘要截前 100 字。
 */
export function parseDraft(raw: string, fallbackTitle = ''): DraftResult | null {
  const text = (raw || '').trim()
  if (!text) return null

  const parsed = extractJSON<{
    title?: unknown
    summary?: unknown
    tags?: unknown
    markdown?: unknown
    content?: unknown
    body?: unknown
  }>(text)

  if (parsed) {
    const markdown = String(parsed.markdown ?? parsed.content ?? parsed.body ?? '').trim()
    // 解析出了 JSON 但没有正文：不能把原始 JSON 字符串当文章存下来
    if (!markdown) return null
    const title = String(parsed.title ?? '').trim() || firstHeading(markdown) || fallbackTitle.trim()
    const summary = String(parsed.summary ?? '').trim() || plainSummary(markdown)
    return {
      title: title.slice(0, 60),
      summary: summary.slice(0, 200),
      tags: asTags(parsed.tags),
      markdown,
    }
  }

  // 没给 JSON：整段当正文
  const markdown = text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i, '$1').trim()
  if (!markdown) return null
  const heading = firstHeading(markdown)
  return {
    title: (heading || fallbackTitle.trim() || markdown.split('\n')[0].slice(0, 30)).slice(0, 60),
    summary: plainSummary(markdown),
    tags: [],
    markdown,
  }
}

/**
 * AI 发布计划（brief）
 *
 * 「自动发布」不是把同一篇稿子原样塞进几十个后台：每个平台的标题上限、
 * 标签数量、摘要长度都不一样。这里用**一次**模型调用同时产出标题 / 摘要 / 标签，
 * 而不是分三次问 —— 一次调用拿到的是互相自洽的结果，也省下 2/3 的等待。
 *
 * 这一层只负责「问什么、怎么解析」，编排（并发、超时、降级）在调用方，
 * 便于在 core 里单测，不必起浏览器环境。
 */
import { extractJSON } from './client'

export interface PublishBriefInput {
  title: string
  /** 正文纯文本（调用方负责截断） */
  content: string
  platformId: string
  platformName: string
  /** 平台标题上限（硬限制，超一个字就会被拒） */
  titleMax?: number
  /** 需要的标签数量（0 = 该平台不用标签） */
  tagCount?: number
  /** 摘要长度上限 */
  summaryMax?: number
  /** 平台调性提示（由规则表提供） */
  styleHint?: string
}

export interface PublishBrief {
  title: string
  summary: string
  tags: string[]
}

/**
 * 各平台需要几个标签
 *
 * 只写有把握的：小红书话题是分发主入口，多点没关系；微博、头条多打标签
 * 会被判成营销；技术社区 3~5 个刚好。表里没有的平台按 4 个。
 */
const TAG_COUNT: Record<string, number> = {
  xiaohongshu: 8,
  weibo: 3,
  zhihu: 5,
  juejin: 5,
  csdn: 5,
  oschina: 5,
  segmentfault: 5,
  cnblogs: 5,
  toutiao: 3,
  baijiahao: 3,
  bilibili: 5,
  douban: 3,
  smzdm: 3,
  jianshu: 4,
}

/** 摘要长度：发布表单的「摘要」普遍 100~200 字 */
const SUMMARY_MAX = 120

export function tagCountFor(platformId: string): number {
  return TAG_COUNT[platformId] ?? 4
}

export function summaryMaxFor(_platformId: string): number {
  return SUMMARY_MAX
}

/**
 * 提示词
 *
 * 明确写「只输出 JSON」+ 逐条规则，是因为模型很容易顺手写一段
 * 「好的，下面是……」，解析就会失败。规则里最要紧的是：
 * 不许编造事实、不许生硬截断、标签不要宽泛。
 */
export function publishBriefPrompt(input: PublishBriefInput): string {
  const titleMax = input.titleMax && input.titleMax > 0 ? input.titleMax : 30
  const tagCount = input.tagCount ?? 4
  const summaryMax = input.summaryMax ?? SUMMARY_MAX

  return [
    `你在为「${input.platformName}」准备一条即将自动发布的内容。`,
    `原标题：${input.title || '（无）'}`,
    '',
    '硬性要求：',
    `- title：不超过 ${titleMax} 个字（这是平台硬限制，超一个字符就会被拒）。保留原意，`,
    '  不改事实、不添加原文里没有的数字或结论；太长就换一种更短的说法，不要生硬截断成半句。',
    `- summary：不超过 ${summaryMax} 个字，一句话说清这篇讲什么。它是发布表单里的「摘要 / 简介」，`,
    '  如果没有摘要栏就不展示，所以不要写成「本文介绍了……」这种废话开头。',
    tagCount > 0
      ? `- tags：${tagCount} 个话题词，每个 2~8 个字，不带 # 号，不要宽泛到无意义（例如「新闻」「科技」）。`
      : '- tags：返回空数组（该平台不用标签）。',
    input.styleHint ? `- 平台调性：${input.styleHint}` : '',
    '',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释：',
    '{"title":"...","summary":"...","tags":["...","..."]}',
    '',
    '正文（节选）：',
    input.content,
  ]
    .filter(line => line !== '')
    .join('\n')
}

/**
 * 解析模型返回
 *
 * 解不出来就返回 null，让调用方退回「规则标题 + 无标签」——
 * 自动发布不能因为模型多写了一句「好的」就整体失败。
 */
export function parsePublishBrief(
  raw: string,
  fallback: { title: string; titleMax?: number; tagCount?: number }
): PublishBrief | null {
  const parsed = extractJSON<{ title?: unknown; summary?: unknown; tags?: unknown }>(raw)
  if (!parsed) return null

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const rawTags = Array.isArray(parsed.tags) ? parsed.tags : []

  const tags = rawTags
    .map(tag => String(tag || '').replace(/^#+/, '').trim())
    .filter(tag => tag.length >= 1 && tag.length <= 12)
    .slice(0, fallback.tagCount ?? 4)

  const finalTitle = title || fallback.title
  if (!finalTitle) return null

  return {
    // 模型偶尔会超长（让它「不超过 N 字」它给 N+3），这里再兜一次
    title: fallback.titleMax && finalTitle.length > fallback.titleMax ? finalTitle.slice(0, fallback.titleMax) : finalTitle,
    summary,
    tags: Array.from(new Set(tags)),
  }
}

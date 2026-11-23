/**
 * AI 自动发布计划（扩展侧编排）
 *
 * 「立即发布」和「存为草稿」的差别不只是 draftOnly：草稿可以乱七八糟，
 * 发布要过平台的硬约束（标题上限、标签、摘要）。所以发布模式在同步之前，
 * 先给每个平台要一份「怎么发」的计划：
 *
 *   { title, summary, tags }  ← 一次模型调用生成
 *
 * 拿到之后再交给页面注入脚本：标题填进去、摘要填进去、标签填进去（或追加到正文），
 * 最后点发布。整条链路上 AI 只负责「写什么」，点按钮仍然是脚本干
 * ——让模型去读 DOM 点按钮既慢又不可靠，那是另一个数量级的成本。
 *
 * 降级：AI 不可用 / 超时 / 解析失败 → 用规则标题 + 不填标签，发布照常进行。
 */
import {
  countChars,
  effectiveTitleMax,
  getPlatformRule,
  platformStyleHint,
  summaryMaxFor,
  tagCountFor,
  type PlatformBrief,
} from '@ugaeo/core'
import { getAISettings, isAIReady } from './ai-settings'

/** 单平台最多等多久：同步不能被模型拖住 */
const AI_TIMEOUT_MS = 9000
/**
 * 一次发布最多问几个平台（多出来的用规则标题，不再排队）
 *
 * 发布模式最多可选 25 个平台（可直发 11 + AI 自动发布 14），上限按这个数量给 ——
 * 以前是 12，第二层放开之后就会出现「后 13 个平台没 AI 文案」的半成品。
 */
const AI_CALL_LIMIT = 25
/** 模型并发上限，避免被上游限流 */
const AI_CONCURRENCY = 3
/** 正文只送前 6000 字：摘要和标签不需要全文 */
const BODY_LIMIT = 6000

export interface BriefPlan {
  /** 该平台要用的标题 / 摘要 / 标签 */
  briefs: Record<string, PlatformBrief>
  /** 需要覆盖的标题（与 briefs 同步，便于只改标题的场景复用） */
  titles: Record<string, string>
  usedAI: number
  /** AI 不可用时的原因，UI 可以直接展示 */
  aiSkipReason?: string
}

async function requestBrief(params: {
  title: string
  content: string
  platformId: string
  platformName: string
  titleMax: number
  tagCount: number
  summaryMax: number
  styleHint: string
}): Promise<PlatformBrief | null> {
  const call = chrome.runtime
    .sendMessage({
      type: 'AI_TASK',
      payload: {
        type: 'brief',
        title: params.title,
        content: params.content,
        platform: params.platformId,
        platformName: params.platformName,
        titleMax: params.titleMax,
        tagCount: params.tagCount,
        summaryMax: params.summaryMax,
        styleHint: params.styleHint,
      },
    })
    .catch(() => null)

  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), AI_TIMEOUT_MS))
  const response = (await Promise.race([call, timeout])) as
    | { ok?: boolean; data?: PlatformBrief }
    | null
    | undefined

  if (!response?.ok || !response.data) return null
  const brief = response.data
  const title = String(brief.title || '').trim()
  if (!title) return null

  // 再校验一次长度：模型偶尔会说「不超过 20 字」然后给 23 字
  const safeTitle = countChars(title) > params.titleMax ? title.slice(0, params.titleMax) : title
  const tags = Array.isArray(brief.tags)
    ? brief.tags
        .map(tag => String(tag || '').replace(/^#+/, '').trim())
        .filter(tag => tag.length >= 1 && tag.length <= 12)
        .slice(0, params.tagCount)
    : []

  return {
    title: safeTitle,
    summary: String(brief.summary || '').trim().slice(0, params.summaryMax),
    tags: Array.from(new Set(tags)),
  }
}

/**
 * 给每个平台要一份发布计划
 *
 * 注意这里**不抛错**：任何一个平台失败都只是少了它的 brief，
 * 同步会退回「规则标题 + 无标签」，用户最多看到「这个平台标题没优化」，
 * 而不是「点了发布什么都没发生」。
 */
export async function planPublishBriefs(params: {
  title: string
  bodyText: string
  platforms: { id: string; name: string }[]
  useAI?: boolean
}): Promise<BriefPlan> {
  const settings = await getAISettings()
  const aiReady = params.useAI !== false && isAIReady(settings) && settings.features.title

  const aiSkipReason = aiReady
    ? undefined
    : !settings.enabled
      ? '未启用 AI，本次只用规则标题、不填标签'
      : !settings.apiKey
        ? '未配置 AI API Key，本次只用规则标题、不填标签'
        : !settings.features.title
          ? 'AI 的「标题优化」开关已关闭，本次只用规则标题、不填标签'
          : undefined

  if (!aiReady) return { briefs: {}, titles: {}, usedAI: 0, aiSkipReason }

  const content = (params.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, BODY_LIMIT)
  const queue = params.platforms.slice(0, AI_CALL_LIMIT)

  const briefs: Record<string, PlatformBrief> = {}
  const titles: Record<string, string> = {}
  let usedAI = 0
  let cursor = 0

  const worker = async () => {
    while (cursor < queue.length) {
      const platform = queue[cursor++]
      const rule = getPlatformRule(platform.id)
      const titleMax = effectiveTitleMax(rule) || 30
      const brief = await requestBrief({
        title: params.title,
        content,
        platformId: platform.id,
        platformName: platform.name,
        titleMax,
        tagCount: tagCountFor(platform.id),
        summaryMax: summaryMaxFor(platform.id),
        styleHint: platformStyleHint(platform.id, platform.name),
      })
      if (!brief) continue
      briefs[platform.id] = brief
      titles[platform.id] = brief.title
      usedAI++
    }
  }

  await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, queue.length) }, () => worker()))

  return { briefs, titles, usedAI, aiSkipReason }
}

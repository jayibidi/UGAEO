/**
 * 标题策略：规则兜底 + AI 改写
 *
 * 为什么两层：
 * - 硬约束（小红书 20 字、B站 40 字、微博不吃书名号）是确定的，用规则表直接算，
 *   不依赖模型，快且稳；
 * - 但「超长之后怎么改」是创作问题。硬切出来的标题常常是半句话，
 *   交给模型换个说法质量明显更好。
 *
 * 降级顺序：AI 成功 → 用 AI 标题；AI 不可用 / 超时 / 结果仍超长 → 用规则截断的版本。
 * 也就是说**无论 AI 在不在，都能发出去**，不会因为模型挂了就卡住同步。
 */
import {
  adaptTitle,
  countChars,
  effectiveTitleMax,
  getPlatformRule,
  platformPreconditions,
  type AdaptAction,
} from '@ugaeo/core'
import { getAISettings, isAIReady } from './ai-settings'

/** 单个平台最多等多久（同步不能被模型拖住） */
const AI_TIMEOUT_MS = 8000
/** 一次同步最多调几次模型：33 个平台全调会等到用户以为卡死 */
const AI_CALL_LIMIT = 8
/** AI 并发的上限，避免被上游限流 */
const AI_CONCURRENCY = 3

export interface TitlePlanItem {
  platformId: string
  platformName: string
  original: string
  adapted: string
  /** ai = 模型改写；其余是规则动作 */
  action: AdaptAction | 'ai'
  note: string
}

export interface TitlePlan {
  /** 需要覆盖标题的平台：只有这里出现的平台才会被改 */
  titles: Record<string, string>
  items: TitlePlanItem[]
  /** 需要人工准备的前置条件（语雀知识库、投稿制平台等） */
  preconditions: { platformId: string; platformName: string; items: string[] }[]
  /** 本次是否真的调用了模型 */
  usedAI: number
  /** AI 不可用时的说明 */
  aiSkipReason?: string
}

interface PlanParams {
  title: string
  bodyText: string
  platforms: { id: string; name: string }[]
  /** 传 false 强制只走规则（用于「关掉 AI」的场景 / 测试） */
  useAI?: boolean
}

/** 调一次模型的标题任务，超时或失败返回 null */
async function aiTitle(original: string, platformName: string, maxLen: number): Promise<string | null> {
  const call = chrome.runtime
    .sendMessage({
      type: 'AI_TASK',
      payload: { type: 'title', title: original, platform: platformName, maxLen },
    })
    .catch(() => null)

  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), AI_TIMEOUT_MS))
  const response = (await Promise.race([call, timeout])) as
    | { ok?: boolean; data?: string[] }
    | null
    | undefined

  if (!response?.ok) return null
  const list = Array.isArray(response.data) ? response.data : []
  return (
    list
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .find(candidate => {
        const len = countChars(candidate)
        return len >= 6 && len <= maxLen
      }) || null
  )
}

/**
 * 算出每个平台的标题
 *
 * 只对「真的要改」的平台产出覆盖值；标题本来就合规的平台原样不动，
 * 避免用户看到一堆莫名其妙的改写。
 */
export async function planTitleAdaptation(params: PlanParams): Promise<TitlePlan> {
  const { title, bodyText, platforms } = params

  const settings = await getAISettings()
  const aiReady = params.useAI !== false && isAIReady(settings) && settings.features.title

  const items: TitlePlanItem[] = []
  const titles: Record<string, string> = {}
  const preconditions: TitlePlan['preconditions'] = []
  let usedAI = 0

  // 第一轮：规则层，先算出哪些平台需要改写
  const pending: { item: TitlePlanItem; maxLen: number }[] = []

  for (const platform of platforms) {
    const rule = getPlatformRule(platform.id)

    const pre = platformPreconditions(platform.id)
    if (pre.length) {
      preconditions.push({ platformId: platform.id, platformName: platform.name, items: pre })
    }

    const adaptation = adaptTitle(platform.id, title, bodyText, rule)
    const item: TitlePlanItem = {
      platformId: platform.id,
      platformName: platform.name,
      original: adaptation.original || title,
      adapted: adaptation.adapted,
      action: adaptation.action,
      note: adaptation.note,
    }

    if (adaptation.action !== 'unchanged' || adaptation.adapted !== (title || '').trim()) {
      titles[platform.id] = adaptation.adapted
      items.push(item)
    }

    if (adaptation.needsAI) {
      pending.push({ item, maxLen: effectiveTitleMax(rule) || countChars(adaptation.adapted) || 30 })
    }
  }

  // 第二轮：超长的交给模型换个说法（最多 AI_CALL_LIMIT 次，3 并发）
  if (aiReady && pending.length) {
    let cursor = 0
    const queue = pending.slice(0, AI_CALL_LIMIT)

    const worker = async () => {
      while (cursor < queue.length) {
        const target = queue[cursor++]
        const better = await aiTitle(target.item.original, target.item.platformName, target.maxLen)
        if (!better) continue
        target.item.adapted = better
        target.item.action = 'ai'
        target.item.note = `原标题 ${countChars(target.item.original)} 字，AI 改为 ${countChars(better)} 字`
        titles[target.item.platformId] = better
        usedAI++
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(AI_CONCURRENCY, queue.length) }, () => worker())
    )
  }

  const aiSkipReason = aiReady
    ? undefined
    : !settings.enabled
      ? '未启用 AI，超长标题按标点截断'
      : !settings.apiKey
        ? '未配置 AI API Key，超长标题按标点截断'
        : !settings.features.title
          ? 'AI 的「标题优化」开关已关闭，超长标题按标点截断'
          : undefined

  return { titles, items, preconditions, usedAI, aiSkipReason }
}

/** 给同步结果用的一句话说明 */
export function describeTitlePlan(plan: TitlePlan): string {
  if (!plan.items.length) return ''
  const parts = plan.items.map(item => `${item.platformName}：${item.note || '已调整'}`)
  return parts.join('；')
}

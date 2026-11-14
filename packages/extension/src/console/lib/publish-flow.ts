/**
 * 发布流程的纯逻辑
 *
 * 抽出来的原因：控制台两个页签（存为草稿 / 立即发布）的差别全在这些判断上，
 * 放在组件里既难测也容易被后人改回「两个页签长得一样」。
 */
import type { DraftRef, Platform, SyncResult } from './types'

/** 平台能否真正公开发布（适配器声明了 publish 能力） */
export function isPublishable(platform: Platform): boolean {
  return !!platform.capabilities?.includes('publish')
}

/** 平台能否把「已存在的草稿」直接发布（而不必重新创建一篇） */
export function canPublishExistingDraft(platform: Platform): boolean {
  return !!platform.capabilities?.includes('publish_existing_draft')
}

/**
 * 按模式切分平台
 *
 * - draft：所有已登录平台都能收草稿
 * - publish：只有声明了 publish 的平台可选，其余锁住并给出原因
 */
export function splitPlatformsByMode(
  platforms: Platform[],
  mode: 'draft' | 'publish'
): { selectable: Platform[]; locked: Platform[] } {
  const authed = platforms.filter(platform => platform.isAuthenticated)
  if (mode === 'draft') {
    return { selectable: authed, locked: [] }
  }
  return {
    selectable: authed.filter(isPublishable),
    locked: authed.filter(platform => !isPublishable(platform)),
  }
}

/**
 * 从一次草稿同步的结果里提炼出可发布的草稿
 *
 * 只收「成功 + 有草稿地址 + 确实只是草稿」的条目；已经发出去的、失败的都不算，
 * 否则用户会在发布页看到一堆没法操作的条目。
 */
export function buildDraftRefs(results: SyncResult[], platforms: Platform[]): DraftRef[] {
  const nameOf = new Map(platforms.map(platform => [platform.id, platform.name]))

  return results
    .filter(result => result.success && result.draftOnly !== false)
    .filter(result => !!result.postUrl || !!result.postId)
    .map(result => ({
      platform: result.platform,
      platformName: result.platformName || nameOf.get(result.platform) || result.platform,
      postId: result.postId,
      postUrl: result.postUrl,
      title: undefined,
    }))
}

/** 这篇草稿能不能自动发布；不能的话走人工 */
export function draftPublishMode(ref: DraftRef, platforms: Platform[]): 'auto' | 'manual' {
  const platform = platforms.find(item => item.id === ref.platform)
  if (!platform) return 'manual'
  if (!canPublishExistingDraft(platform)) return 'manual'
  // 没有草稿 id 的平台即使声明了能力也发不出去（只能给链接人工点）
  return ref.postId ? 'auto' : 'manual'
}

/** 本次同步里每个平台是否只存草稿（发布模式下一律 false，由能力兜底） */
export function buildDraftOnlyMap(mode: 'draft' | 'publish', platformIds: string[]): Record<string, boolean> {
  const draftOnly = mode === 'draft'
  return Object.fromEntries(platformIds.map(id => [id, draftOnly]))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 时间戳 → datetime-local 输入框需要的字符串（本地时区） */
export function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** datetime-local 字符串 → 时间戳；非法输入返回 null */
export function parseDateTimeLocal(value: string): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

/** 默认的定时时间：当前时间 + 10 分钟，向上取整到 5 分钟 */
export function defaultScheduleValue(now = Date.now()): string {
  const base = now + 10 * 60 * 1000
  const rounded = Math.ceil(base / (5 * 60 * 1000)) * 5 * 60 * 1000
  return toDateTimeLocal(rounded)
}

/**
 * 定时时间是否可用
 *
 * 后台给定时任务留了 1 分钟的最小提前量；这里提前拦一次，
 * 免得用户点了按钮才收到「至少要晚于当前时间 1 分钟」的报错。
 */
export function isScheduleValid(timestamp: number | null, now = Date.now()): boolean {
  if (!timestamp) return false
  return timestamp >= now + 60 * 1000
}

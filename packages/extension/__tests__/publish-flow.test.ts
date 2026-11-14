/**
 * 发布流程纯逻辑
 *
 * 这组断言对应控制台「存为草稿 / 立即发布」两个页签的分工：
 * 一旦有人把两边改回同一个行为，或者让不支持直发的平台混进发布列表，这里会先红。
 */
import { describe, expect, it } from 'vitest'
import {
  buildDraftOnlyMap,
  buildDraftRefs,
  canPublishExistingDraft,
  defaultScheduleValue,
  draftPublishMode,
  isPublishable,
  isScheduleValid,
  parseDateTimeLocal,
  splitPlatformsByMode,
  toDateTimeLocal,
} from '../src/console/lib/publish-flow'
import type { Platform, SyncResult } from '../src/console/lib/types'

function platform(overrides: Partial<Platform> & { id: string }): Platform {
  return {
    name: overrides.id,
    icon: '',
    homepage: `https://${overrides.id}.example.com`,
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft'],
    ...overrides,
  }
}

const zhihu = platform({ id: 'zhihu', name: '知乎', capabilities: ['article', 'draft', 'publish', 'publish_existing_draft'] })
const juejin = platform({ id: 'juejin', name: '掘金', capabilities: ['article', 'draft', 'publish', 'publish_existing_draft'] })
const sohu = platform({ id: 'sohu', name: '搜狐号', capabilities: ['article', 'draft', 'publish'] })
const douban = platform({ id: 'douban', name: '豆瓣', capabilities: ['article', 'draft'] })
const offline = platform({ id: 'weibo', name: '微博', isAuthenticated: false, capabilities: ['publish'] })

function result(overrides: Partial<SyncResult> & { platform: string }): SyncResult {
  return { success: true, timestamp: Date.now(), ...overrides }
}

describe('平台筛选', () => {
  it('只有声明 publish 的平台算可直发', () => {
    expect(isPublishable(zhihu)).toBe(true)
    expect(isPublishable(sohu)).toBe(true)
    expect(isPublishable(douban)).toBe(false)
  })

  it('存为草稿模式：所有已登录平台都能选', () => {
    const { selectable, locked } = splitPlatformsByMode([zhihu, douban, offline], 'draft')
    expect(selectable.map(p => p.id)).toEqual(['zhihu', 'douban'])
    expect(locked).toEqual([])
  })

  it('立即发布模式：仅草稿平台被锁住，未登录平台两边都不出现', () => {
    const { selectable, locked } = splitPlatformsByMode([zhihu, sohu, douban, offline], 'publish')
    expect(selectable.map(p => p.id)).toEqual(['zhihu', 'sohu'])
    expect(locked.map(p => p.id)).toEqual(['douban'])
  })
})

describe('草稿转发布', () => {
  it('只收成功、且确实只是草稿、且有地址的条目', () => {
    const refs = buildDraftRefs(
      [
        result({ platform: 'zhihu', postId: '1', postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' }),
        result({ platform: 'juejin', postId: '2', draftOnly: false, postUrl: 'https://juejin.cn/post/2' }),
        result({ platform: 'sohu', success: false, error: '登录失效' }),
        result({ platform: 'douban', success: true }),
      ],
      [zhihu, juejin, sohu, douban]
    )

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ platform: 'zhihu', postId: '1', platformName: '知乎' })
  })

  it('有草稿发布接口且有草稿 ID 才算「可自动发布」', () => {
    expect(draftPublishMode({ platform: 'zhihu', postId: '1' }, [zhihu])).toBe('auto')
    // 声明了能力但没拿到 id：只能给链接人工点，不能假装能发
    expect(draftPublishMode({ platform: 'zhihu' }, [zhihu])).toBe('manual')
    // 平台有直发能力但没有「发布已有草稿」的接口
    expect(draftPublishMode({ platform: 'sohu', postId: '9' }, [sohu])).toBe('manual')
    expect(canPublishExistingDraft(sohu)).toBe(false)
  })
})

describe('草稿标记', () => {
  it('草稿模式全部标记为草稿，发布模式全部尝试发布', () => {
    expect(buildDraftOnlyMap('draft', ['zhihu', 'juejin'])).toEqual({ zhihu: true, juejin: true })
    expect(buildDraftOnlyMap('publish', ['zhihu', 'juejin'])).toEqual({ zhihu: false, juejin: false })
  })

  it('空选择返回空对象，不会给后台传 undefined', () => {
    expect(buildDraftOnlyMap('draft', [])).toEqual({})
  })
})

describe('定时时间', () => {
  const base = new Date(2026, 10, 13, 10, 0, 0).getTime()

  it('datetime-local 与时间戳可以互转（本地时区）', () => {
    expect(toDateTimeLocal(base)).toBe('2026-11-13T10:00')
    expect(parseDateTimeLocal('2026-11-13T10:00')).toBe(base)
  })

  it('非法输入返回 null，不会静默变成 NaN 时间', () => {
    expect(parseDateTimeLocal('')).toBeNull()
    expect(parseDateTimeLocal('not-a-date')).toBeNull()
  })

  it('默认值至少比现在晚，且落在 5 分钟刻度上', () => {
    const value = defaultScheduleValue(base)
    const timestamp = parseDateTimeLocal(value)!
    expect(timestamp).toBeGreaterThan(base)
    expect(new Date(timestamp).getMinutes() % 5).toBe(0)
  })

  it('至少提前 1 分钟，不足则判为无效', () => {
    expect(isScheduleValid(base + 60 * 1000, base)).toBe(true)
    expect(isScheduleValid(base + 59 * 1000, base)).toBe(false)
    expect(isScheduleValid(null, base)).toBe(false)
  })
})

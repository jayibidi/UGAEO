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
  canAutoPublish,
  canPublishExistingDraft,
  countUnauthenticated,
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
const ithome = platform({ id: 'ithome', name: 'IT之家', capabilities: ['article', 'draft'], noEditor: true })
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

  it('存为草稿模式：全部平台都能选（未登录的也在列表里，只做标记）', () => {
    const { selectable, locked } = splitPlatformsByMode([zhihu, douban, offline], 'draft')
    expect(selectable.map(p => p.id)).toEqual(['zhihu', 'douban', 'weibo'])
    expect(locked).toEqual([])
  })

  it('存为草稿模式：全部平台一个不少，本地导出工具不算', () => {
    // 草稿模式 = 全部内容平台（当前 31 个）；zip-download 是本地工具，不参与
    const many = [
      ...Array.from({ length: 11 }, (_, i) => platform({ id: `pub${i}`, capabilities: ['article', 'draft', 'publish'] })),
      ...Array.from({ length: 14 }, (_, i) => platform({ id: `ai${i}`, capabilities: ['article', 'draft'] })),
      ...Array.from({ length: 6 }, (_, i) => platform({ id: `man${i}`, capabilities: ['article', 'draft'], noEditor: true })),
      platform({ id: 'zip-download', capabilities: ['article'] }),
    ]

    const draft = splitPlatformsByMode(many, 'draft')
    expect(draft.selectable).toHaveLength(31)

    // 发布模式：可直发 + AI 自动发布都能选，只剩 6 个词条平台锁住
    const publish = splitPlatformsByMode(many, 'publish')
    expect(publish.selectable).toHaveLength(25)
    expect(publish.locked).toHaveLength(6)
  })

  it('立即发布模式：AI 自动发布层可选，词条平台锁住，未登录平台两边都不出现', () => {
    const { selectable, locked } = splitPlatformsByMode([zhihu, sohu, douban, ithome, offline], 'publish')
    // 豆瓣（有编辑器、没有直发接口）走 AI 自动发布，能选；IT之家没有文章编辑器，锁住
    expect(selectable.map(p => p.id)).toEqual(['zhihu', 'sohu', 'douban'])
    expect(locked.map(p => p.id)).toEqual(['ithome'])
  })

  it('canAutoPublish：可直发 + AI 自动发布为真，词条平台为假', () => {
    expect(canAutoPublish(zhihu)).toBe(true)
    expect(canAutoPublish(douban)).toBe(true)
    expect(canAutoPublish(ithome)).toBe(false)
  })

  it('未登录平台混在草稿目标里时能数出来，好提示先登录', () => {
    expect(countUnauthenticated([zhihu, douban, offline], ['zhihu', 'weibo'])).toBe(1)
    expect(countUnauthenticated([zhihu, douban, offline], ['zhihu'])).toBe(0)
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

describe('登录态待检测的平台', () => {
  const jianshu = platform({ id: 'jianshu', name: '简书', isAuthenticated: false, needsProbe: true })

  it('发布模式：待检测的平台不锁住（它们的登录态要开页实测才知道）', () => {
    const { selectable } = splitPlatformsByMode([zhihu, jianshu], 'publish')
    expect(selectable.map(p => p.id)).toEqual(['zhihu', 'jianshu'])
  })

  it('发布模式：明确未登录的平台仍然不进列表', () => {
    const { selectable } = splitPlatformsByMode([zhihu, offline], 'publish')
    expect(selectable.map(p => p.id)).toEqual(['zhihu'])
  })

  it('待检测的词条平台进「锁定」组，不会被当成可以自动发布', () => {
    const bafang = platform({ id: 'bafang', name: '八方资源网', isAuthenticated: false, needsProbe: true, noEditor: true })
    const { selectable, locked } = splitPlatformsByMode([zhihu, bafang], 'publish')
    expect(selectable.map(p => p.id)).toEqual(['zhihu'])
    expect(locked.map(p => p.id)).toEqual(['bafang'])
  })
})

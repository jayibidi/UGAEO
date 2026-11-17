/**
 * 标题策略：规则兜底 + AI 改写
 *
 * 锁死三件事：
 * 1. 标题本来就合规的平台不被乱改（否则用户会看到一堆没必要的改写）；
 * 2. AI 成功 → 用 AI 标题；每个 AI 标题都要过长度校验；
 * 3. AI 不可用 / 失败 / 超时 → 一定退回规则截断，绝不能因为模型挂了就发不出去。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会被提到文件顶部，工厂里只能引用 vi.hoisted 出来的东西
const { aiSettings } = vi.hoisted(() => ({
  aiSettings: {
    enabled: true,
    apiKey: 'sk-test',
    baseUrl: 'https://example.com',
    model: 'test',
    models: [] as string[],
    temperature: 0.7,
    features: { title: true, summary: true, tags: true, adapt: true },
  },
}))

vi.mock('../src/lib/ai-settings', () => ({
  getAISettings: vi.fn(async () => aiSettings),
  isAIReady: vi.fn(() => !!aiSettings.enabled && !!aiSettings.apiKey),
  AI_SETTINGS_KEY: 'aiSettings',
  DEFAULT_AI_SETTINGS: aiSettings,
  saveAISettings: vi.fn(),
  toAIConfig: vi.fn(),
  maskApiKey: vi.fn(),
}))

import { planTitleAdaptation } from '../src/lib/title-strategy'

const LONG_TITLE = '我用这套方法把三十四个平台的发布流程压缩到了十分钟，附完整清单和踩坑记录'
const XHS_LIMIT = 20

function mockAI(impl: (payload: any) => any) {
  const chromeAny = (globalThis as any).chrome
  chromeAny.runtime.sendMessage.mockImplementation(async (message: any) => impl(message.payload))
}

beforeEach(() => {
  aiSettings.enabled = true
  aiSettings.apiKey = 'sk-test'
  aiSettings.features.title = true
  mockAI(() => ({ ok: true, data: [] }))
})

describe('只改需要改的平台', () => {
  it('标题合规时一个字都不动', async () => {
    const plan = await planTitleAdaptation({
      title: '三个方法提升同步效率',
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.items).toEqual([])
    expect(plan.titles).toEqual({})
    expect(plan.usedAI).toBe(0)
  })

  it('超长平台才会出现在覆盖表里', async () => {
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [
        { id: 'xiaohongshu', name: '小红书' },
        { id: 'zhihu', name: '知乎' },
      ],
    })
    // 小红书 20 字上限 → 改；知乎 100 字上限 → 原样
    expect(Object.keys(plan.titles)).toEqual(['xiaohongshu'])
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].platformId).toBe('xiaohongshu')
  })
})

describe('AI 改写', () => {
  it('AI 返回合规标题时采用，并记录字数变化', async () => {
    mockAI(() => ({ ok: true, data: ['十分钟搞定全平台发布'] }))
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.usedAI).toBe(1)
    expect(plan.titles.xiaohongshu).toBe('十分钟搞定全平台发布')
    expect(plan.items[0].action).toBe('ai')
    expect(plan.items[0].note).toContain('AI')
  })

  it('AI 返回的标题仍超长时不采用，保留规则截断的结果', async () => {
    mockAI(() => ({ ok: true, data: ['这个标题依然非常非常非常非常非常非常长超过二十个字了'] }))
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.usedAI).toBe(0)
    expect(plan.titles.xiaohongshu.length).toBeLessThanOrEqual(XHS_LIMIT)
    expect(plan.items[0].action).toBe('truncated')
  })

  it('AI 失败时静默降级到截断，不抛错', async () => {
    mockAI(() => {
      throw new Error('upstream 500')
    })
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.usedAI).toBe(0)
    expect(plan.titles.xiaohongshu.length).toBeLessThanOrEqual(XHS_LIMIT)
    expect(plan.items[0].action).toBe('truncated')
  })

  it('传 maxLen 给模型，避免它再产出超长标题', async () => {
    let received: any = null
    mockAI(payload => {
      received = payload
      return { ok: true, data: ['十分钟搞定全平台'] }
    })
    await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(received.type).toBe('title')
    expect(received.platform).toBe('小红书')
    // 小红书硬上限 20 字，必须透传给模型，否则它还是会写 30 个字
    expect(received.maxLen).toBe(20)
    expect(received.title).toBe(LONG_TITLE)
  })
})

describe('AI 不可用', () => {
  it('没配 key 时只走规则，并给出原因', async () => {
    aiSettings.apiKey = ''
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.usedAI).toBe(0)
    expect(plan.items[0].action).toBe('truncated')
    expect(plan.aiSkipReason).toContain('API Key')
  })

  it('标题优化开关关掉时也不调模型', async () => {
    aiSettings.features.title = false
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })
    expect(plan.usedAI).toBe(0)
    expect(plan.aiSkipReason).toContain('标题优化')
  })

  it('显式传 useAI=false 时完全不碰模型', async () => {
    const spy = vi.spyOn((globalThis as any).chrome.runtime, 'sendMessage')
    const plan = await planTitleAdaptation({
      title: LONG_TITLE,
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
      useAI: false,
    })
    expect(plan.usedAI).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('前置条件与空标题', () => {
  it('把平台的硬性前置条件单独收出来，便于提示', async () => {
    const plan = await planTitleAdaptation({
      title: '一篇投稿稿',
      bodyText: '',
      platforms: [
        { id: 'ithome', name: 'IT之家' },
        { id: 'zhihu', name: '知乎' },
      ],
    })
    expect(plan.preconditions).toHaveLength(1)
    expect(plan.preconditions[0].platformId).toBe('ithome')
    expect(plan.preconditions[0].items.length).toBeGreaterThan(0)
  })

  it('标题为空时用正文首句补', async () => {
    const plan = await planTitleAdaptation({
      title: '',
      bodyText: '这次我们重做了同步链路，速度提升三倍以上。',
      platforms: [{ id: 'zhihu', name: '知乎' }],
    })
    expect(plan.items[0].action).toBe('from-body')
    expect(plan.titles.zhihu).toContain('同步链路')
  })
})

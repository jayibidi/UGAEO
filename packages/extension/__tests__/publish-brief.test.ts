/**
 * AI 自动发布计划的编排
 *
 * 锁死四件事：
 * 1. AI 可用 → 每个平台拿到标题 / 摘要 / 标签，且标题过了平台长度校验；
 * 2. AI 未配置 / 超时 / 返回垃圾 → 返回空计划，绝不让同步失败；
 * 3. 单个平台失败不影响其他平台；
 * 4. 发出的是 `brief` 任务，而且带上平台名与标题上限（提示词要用）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { planPublishBriefs } from '../src/lib/publish-brief'

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书' },
  { id: 'zhihu', name: '知乎' },
]

function mockAI(impl: (payload: any) => any) {
  const chromeAny = (globalThis as any).chrome
  chromeAny.runtime.sendMessage.mockImplementation(async (message: any) => impl(message.payload))
}

beforeEach(() => {
  aiSettings.enabled = true
  aiSettings.apiKey = 'sk-test'
  aiSettings.features.title = true
})

describe('planPublishBriefs', () => {
  it('AI 可用时每个平台都拿到标题 / 摘要 / 标签', async () => {
    mockAI((payload: any) => ({
      ok: true,
      data: { title: `${payload.platformName}标题`, summary: '一句话摘要', tags: ['运营', '效率'] },
    }))

    const plan = await planPublishBriefs({ title: '原标题', bodyText: '正文', platforms: PLATFORMS })

    expect(plan.usedAI).toBe(2)
    expect(plan.briefs.xiaohongshu.title).toBe('小红书标题')
    expect(plan.briefs.zhihu.tags).toEqual(['运营', '效率'])
    expect(plan.aiSkipReason).toBeUndefined()
  })

  it('请求里带平台名与平台标题上限（提示词要用）', async () => {
    const sent: any[] = []
    mockAI((payload: any) => {
      sent.push(payload)
      return { ok: true, data: { title: '标题', summary: '', tags: [] } }
    })

    await planPublishBriefs({ title: '原', bodyText: '', platforms: [{ id: 'xiaohongshu', name: '小红书' }] })

    expect(sent[0].type).toBe('brief')
    expect(sent[0].platformName).toBe('小红书')
    // 小红书标题上限 20，规则表里的硬限制必须传下去
    expect(sent[0].titleMax).toBe(20)
    expect(sent[0].tagCount).toBe(8)
  })

  it('AI 返回超长标题时按平台上限裁掉', async () => {
    mockAI(() => ({
      ok: true,
      data: { title: '这是一个明显超过小红书二十字上限的标题它还在继续变长', summary: '', tags: [] },
    }))

    const plan = await planPublishBriefs({
      title: '原',
      bodyText: '',
      platforms: [{ id: 'xiaohongshu', name: '小红书' }],
    })

    expect(plan.briefs.xiaohongshu.title.length).toBeLessThanOrEqual(20)
  })

  it('未启用 AI 时直接返回空计划并给出原因', async () => {
    aiSettings.enabled = false
    const plan = await planPublishBriefs({ title: '原', bodyText: '', platforms: PLATFORMS })
    expect(plan.briefs).toEqual({})
    expect(plan.usedAI).toBe(0)
    expect(plan.aiSkipReason).toContain('未启用 AI')
  })

  it('AI 调用失败（ok:false）时整轮降级，不抛错', async () => {
    mockAI(() => ({ ok: false, error: '模型超时' }))
    const plan = await planPublishBriefs({ title: '原', bodyText: '', platforms: PLATFORMS })
    expect(plan.usedAI).toBe(0)
    expect(plan.briefs).toEqual({})
  })

  it('一个平台失败不影响另一个', async () => {
    mockAI((payload: any) =>
      payload.platform === 'xiaohongshu'
        ? { ok: false }
        : { ok: true, data: { title: '知乎标题', summary: '摘要', tags: ['技术'] } }
    )

    const plan = await planPublishBriefs({ title: '原', bodyText: '', platforms: PLATFORMS })
    expect(plan.briefs.xiaohongshu).toBeUndefined()
    expect(plan.briefs.zhihu.title).toBe('知乎标题')
    expect(plan.usedAI).toBe(1)
  })
})

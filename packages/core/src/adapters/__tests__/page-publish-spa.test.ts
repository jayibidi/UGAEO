import { describe, expect, it } from 'vitest'
import type { RuntimeInterface } from '../../runtime/interface'
import { XiaohongshuAdapter } from '../platforms/xiaohongshu'
import { ToutiaoAdapter } from '../platforms/toutiao'
import { KuaidongAdapter } from '../platforms/submission-draft'
import { BaiduZhidaoAdapter } from '../platforms/content-communities'
import type { InjectedPublishPayload, InjectedPublishResult } from '../page-publish'

type ExecuteResult = Partial<InjectedPublishResult>

/**
 * 最小 runtime：记录注入了几次、注入了什么
 */
function createRuntime(scriptResult: ExecuteResult | null | undefined) {
  const created: string[] = []
  const payloads: InjectedPublishPayload[] = []
  const runtime = {
    type: 'extension',
    fetch: async () => new Response('{}', { status: 200 }),
    cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    session: { get: async () => null, set: async () => {} },
    tabs: {
      query: async () => [],
      create: async (url: string) => {
        created.push(url)
        return { id: 1 }
      },
      waitForLoad: async () => {},
      executeScript: async (_tabId: number, _func: unknown, args: unknown[]) => {
        payloads.push(args[0] as InjectedPublishPayload)
        return scriptResult
      },
    },
  } as unknown as RuntimeInterface
  return { runtime, created, payloads }
}

function noDelay<T extends { delay: (ms: number) => Promise<void> }>(adapter: T): T {
  adapter.delay = async () => {}
  return adapter
}

const article = {
  title: '标题',
  html: '<p>正文内容足够长以便通过校验</p>',
  cover: 'https://img.example.com/cover.jpg',
} as never

describe('小红书 · 写长文', () => {
  it('必须带入口步骤（写长文 → 新的创作），否则首页根本没有标题框', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'filled' })
    const adapter = noDelay(new XiaohongshuAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    const payload = payloads[0]
    expect(payload.entrySteps.map(step => step[0])).toEqual(['写长文', '新的创作'])
    expect(payload.titleSelectors.some(s => s.includes('标题'))).toBe(true)
    expect(payload.editorSelectors.length).toBeGreaterThan(0)
  })

  it('长文不强制图片：以前写死 requireImages，拿不到图就永远停在「请手动补充图片」', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'filled' })
    const adapter = noDelay(new XiaohongshuAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    expect(payloads[0].requireImages).toBe(false)
  })

  it('草稿模式会把平台的「存草稿」文案带上，否则内容只活在编辑器里', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'drafted' })
    const adapter = noDelay(new XiaohongshuAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(payloads[0].autoPublish).toBe(false)
    expect(payloads[0].draftTexts.length).toBeGreaterThan(0)
    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.message).toContain('草稿')
  })

  it('长文发布前要排版：prepareSteps 必须包含一键排版', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'published' })
    const adapter = noDelay(new XiaohongshuAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: false })

    expect(payloads[0].autoPublish).toBe(true)
    expect(payloads[0].prepareSteps.map(step => step[0])).toContain('一键排版')
  })
})

describe('头条号', () => {
  it('标题 / 正文 / 草稿按钮 / 发布按钮都配上，且等待时间给足', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'filled' })
    const adapter = noDelay(new ToutiaoAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    const payload = payloads[0]
    expect(payload.titleSelectors).toContain('textarea.article-title')
    expect(payload.editorSelectors).toContain('.ProseMirror')
    expect(payload.draftTexts).toContain('存草稿')
    expect(payload.waitMs).toBeGreaterThanOrEqual(15000)
    // 入口步骤只点「继续编辑 / 我知道了」，绝不点「放弃」丢掉用户草稿
    expect(payload.entrySteps.flat()).not.toContain('放弃')
  })

  it('发布走两步：先预览并发布，再在弹窗里确认', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'published' })
    const adapter = noDelay(new ToutiaoAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: false })

    expect(payloads[0].publishTexts[0]).toBe('预览并发布')
    expect(payloads[0].confirmTexts).toContain('发布')
  })
})

describe('被踢到登录页时要说人话', () => {
  it('needs_login 报「需要登录」，而不是「页面结构可能已变化」', async () => {
    const { runtime } = createRuntime({
      ok: false,
      stage: 'needs_login',
      message: '打开编辑器时被重定向到登录页',
      finalUrl: 'https://mp.toutiao.com/login',
    })
    const adapter = noDelay(new ToutiaoAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('登录')
    expect(result.error).not.toContain('未找到标题输入框')
    expect(result.postUrl).toContain('login')
  })
})

describe('纯人工平台（百科词条 / 问答）', () => {
  it('快懂百科只开页面不注入，绝不算失败', async () => {
    const { runtime, payloads, created } = createRuntime({ ok: true, stage: 'filled' })
    const adapter = noDelay(new KuaidongAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.message).toContain('词条')
    expect(created[0]).toBe('https://www.baike.com/create')
    // 关键：一次注入都不发，避免把标题打进站内搜索框
    expect(payloads.length).toBe(0)
  })

  it('百度知道同样只开页面，并说明是问答形态', async () => {
    const { runtime, payloads } = createRuntime({ ok: true, stage: 'filled' })
    const adapter = noDelay(new BaiduZhidaoAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.message).toContain('问答')
    expect(payloads.length).toBe(0)
  })

  it('自检里标记为 manualOnly，深度体检会跳过', async () => {
    const { runtime } = createRuntime(undefined)
    const kuaidong = new KuaidongAdapter()
    await kuaidong.init(runtime)
    const zhidao = new BaiduZhidaoAdapter()
    await zhidao.init(runtime)

    expect(kuaidong.getDiagnostics().manualOnly).toBe(true)
    expect(zhidao.getDiagnostics().manualOnly).toBe(true)
    // 编辑器型平台不能误标
    const toutiao = new ToutiaoAdapter()
    await toutiao.init(runtime)
    expect(toutiao.getDiagnostics().manualOnly).toBeFalsy()
  })
})

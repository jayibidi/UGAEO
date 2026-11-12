import { describe, expect, it } from 'vitest'
import type { RuntimeInterface } from '../../runtime/interface'
import { IthomeAdapter } from '../platforms/submission-draft'
import { JianshuAdapter } from '../platforms/content-communities'

type ExecuteResult = { ok: boolean; stage: string; message?: string; url?: string }

/**
 * 造一个最小 runtime：tabs 走脚本，executeScript 返回预设结果
 */
function createRuntime(scriptResult: ExecuteResult | null | undefined): {
  runtime: RuntimeInterface
  created: string[]
} {
  const created: string[] = []
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
      executeScript: async () => scriptResult,
    },
  } as unknown as RuntimeInterface
  return { runtime, created }
}

/** 跳过基类里等待编辑器渲染的延时 */
function noDelay<T extends { delay: (ms: number) => Promise<void> }>(adapter: T): T {
  adapter.delay = async () => {}
  return adapter
}

const article = { title: '标题', html: '<p>正文内容足够长以便通过校验</p>' } as never

describe('投稿制平台（仅草稿层）', () => {
  it('不需要登录态，避免投稿页被判成「未登录」', async () => {
    const { runtime } = createRuntime(undefined)
    const adapter = new IthomeAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.error).toBeUndefined()
  })

  it('注入失败时不算发布失败，降级为「已打开投稿页」', async () => {
    const { runtime } = createRuntime({ ok: false, stage: 'failed', message: '未找到标题输入框' })
    const adapter = noDelay(new IthomeAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.message).toContain('投稿')
    expect(result.postUrl).toContain('ithome.com')
  })

  it('填入成功后仍提示需要人工提交', async () => {
    const { runtime } = createRuntime({ ok: true, stage: 'filled', url: 'https://www.ithome.com/tougao/' })
    const adapter = noDelay(new IthomeAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.message).toContain('手动提交')
  })
})

describe('编辑器型平台', () => {
  it('即便是草稿模式，找不到编辑器也要报失败（不能假装成功）', async () => {
    const { runtime } = createRuntime({ ok: false, stage: 'failed', message: '未找到标题输入框' })
    const adapter = noDelay(new JianshuAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('未找到标题输入框')
  })

  it('草稿模式下填入成功，结果标记 draftOnly', async () => {
    const { runtime } = createRuntime({ ok: true, stage: 'filled', url: 'https://www.jianshu.com/writer' })
    const adapter = noDelay(new JianshuAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
  })

  it('立即发布且页面报成功时，result 不带 draftOnly', async () => {
    const { runtime } = createRuntime({ ok: true, stage: 'published', url: 'https://www.jianshu.com/p/abc' })
    const adapter = noDelay(new JianshuAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: false })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(false)
    expect(result.reviewStatus).toBe('reviewing')
  })
})

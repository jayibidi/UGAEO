import { describe, expect, it } from 'vitest'
import type { RuntimeInterface } from '../../runtime/interface'
import { IthomeAdapter } from '../platforms/submission-draft'
import { JianshuAdapter } from '../platforms/content-communities'

type ExecuteResult = { ok: boolean; stage: string; message?: string; url?: string }

/**
 * 造一个最小 runtime：tabs 走脚本，executeScript 返回预设结果
 */
function createRuntime(
  scriptResult: ExecuteResult | null | undefined,
  cookieMap: Record<string, Array<{ name: string; value: string; domain: string; path: string }>> = {}
): {
  runtime: RuntimeInterface
  created: string[]
  injected: number
} {
  const created: string[] = []
  const stats = { injected: 0 }
  const runtime = {
    type: 'extension',
    fetch: async () => new Response('{}', { status: 200 }),
    cookies: {
      get: async (target: string) =>
        Object.entries(cookieMap).find(([key]) => target.includes(key))?.[1] ?? [],
      set: async () => {},
      remove: async () => {},
    },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    session: { get: async () => null, set: async () => {} },
    tabs: {
      query: async () => [],
      create: async (url: string) => {
        created.push(url)
        return { id: 1 }
      },
      waitForLoad: async () => {},
      executeScript: async () => {
        stats.injected++
        return scriptResult
      },
    },
  } as unknown as RuntimeInterface
  return {
    runtime,
    created,
    get injected() {
      return stats.injected
    },
  }
}

/** 跳过基类里等待编辑器渲染的延时 */
function noDelay<T extends { delay: (ms: number) => Promise<void> }>(adapter: T): T {
  adapter.delay = async () => {}
  return adapter
}

const article = { title: '标题', html: '<p>正文内容足够长以便通过校验</p>' } as never

describe('投稿制平台（仅草稿层）', () => {
  it('投稿也要登录：无登录态时如实判未登录，并指向门户', async () => {
    const { runtime } = createRuntime(undefined)
    const adapter = new IthomeAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    // 以前这里标「无需登录」，用户登录了却看不到自己的状态；现在必须如实说明
    expect(auth.authMode).not.toBe('public')
    expect(auth.error).toContain('https://www.ithome.com')
  })

  it('有登录态时判为已登录，但仍只到草稿层', async () => {
    const { runtime } = createRuntime(undefined, {
      'ithome.com': [{ name: 'it_passport', value: 'x', domain: '.ithome.com', path: '/' }],
    })
    const adapter = new IthomeAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
    expect(adapter.meta.capabilities).not.toContain('publish')
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

  it('纯人工平台只开入口页、不发注入，并说清楚要人工投递', async () => {
    // IT之家的投稿入口是说明页（0 个输入框），硬填只会把标题打进搜索框
    const env = createRuntime({ ok: true, stage: 'filled', url: 'https://dyn.ithome.com/tougao' })
    const adapter = noDelay(new IthomeAdapter())
    await adapter.init(env.runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.message).toContain('人工投递')
    expect(env.injected).toBe(0)
    expect(env.created[0]).toContain('dyn.ithome.com/tougao')
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

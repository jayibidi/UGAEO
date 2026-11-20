import { describe, expect, it } from 'vitest'
import type { RuntimeInterface } from '../../runtime/interface'
import { NeteaseAdapter, TencentOmAdapter } from '../platforms/news-portals'
import { SmzdmAdapter } from '../platforms/content-communities'
import { BafangAdapter, Huangye88Adapter } from '../platforms/b2b-directory'
import { CnblogsAdapter } from '../platforms/cnblogs'
import type { InjectedPublishPayload, InjectedPublishResult } from '../page-publish'

const article = {
  title: '标题',
  html: '<p>正文内容足够长以便通过校验</p>',
  markdown: '## 正文内容足够长以便通过校验',
  cover: 'https://img.example.com/cover.jpg',
} as never

/**
 * 可编排的 runtime
 *
 * `steps` 按调用顺序依次返回注入结果；返回 `Error` 表示抛异常。
 * 记录每次都打开了哪些地址、注入了什么参数。
 */
function createRuntime(steps: Array<Partial<InjectedPublishResult> | Error>) {
  const created: string[] = []
  const payloads: InjectedPublishPayload[] = []
  const removed: number[] = []
  let call = 0

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
        return { id: created.length }
      },
      waitForLoad: async () => {},
      remove: async (tabId: number) => {
        removed.push(tabId)
      },
      executeScript: async (_tabId: number, _func: unknown, args: unknown[]) => {
        payloads.push(args[0] as InjectedPublishPayload)
        const step = steps[call++]
        if (step instanceof Error) throw step
        return step
      },
    },
  } as unknown as RuntimeInterface

  return { runtime, created, payloads, removed }
}

function noDelay<T extends { delay: (ms: number) => Promise<void> }>(adapter: T): T {
  adapter.delay = async () => {}
  return adapter
}

describe('多入口候选：地址改版后不再一次定生死', () => {
  it('主入口找不到标题框 → 换备用入口再注入一次', async () => {
    const { runtime, created, payloads, removed } = createRuntime([
      { ok: false, stage: 'failed', message: '没有标题框', missing: ['title'] },
      { ok: true, stage: 'drafted', message: '已存草稿' },
    ])
    const adapter = noDelay(new NeteaseAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[0]).toBe('https://mp.163.com/#/article-publish')
    expect(created[1]).toContain('mp.163.com')
    // 没用的那个标签页要关掉，不能给用户留一堆 404
    expect(removed).toEqual([1])
    // 备用入口少等一会儿，避免一次同步卡到分钟级
    expect(payloads[1].waitMs).toBeLessThan(payloads[0].waitMs)
  })

  it('全部入口都失败时，报错里带上「试过几个入口」', async () => {
    const { runtime } = createRuntime([
      { ok: false, stage: 'failed', message: '没有标题框', missing: ['title'] },
      { ok: false, stage: 'failed', message: '还是没有', missing: ['title'] },
      { ok: false, stage: 'failed', message: '仍然没有', missing: ['title'] },
    ])
    const adapter = noDelay(new NeteaseAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('仍然没有')
    expect(result.error).toContain('已尝试 3 个入口地址')
  })

  it('被踢到登录页时不再试备用入口（换地址也进不去）', async () => {
    const { runtime, created } = createRuntime([
      { ok: false, stage: 'needs_login', message: '请先登录' },
    ])
    const adapter = noDelay(new TencentOmAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('登录')
    expect(created).toHaveLength(1)
  })
})

describe('点了入口页面就跳走：这不叫失败', () => {
  it('上下文被销毁后等加载完重注入一次', async () => {
    const { runtime, payloads } = createRuntime([
      new Error('Execution context was destroyed, most likely because of a navigation'),
      { ok: true, stage: 'drafted', message: '已存草稿' },
    ])
    const adapter = noDelay(new NeteaseAdapter())
    await adapter.init(runtime)

    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(payloads).toHaveLength(2)
  })
})

describe('平台形态与地址（v2.8.4 回归）', () => {
  it('网易号不再用会 302 到 404 的 article/edit.html', async () => {
    const { runtime, created } = createRuntime([{ ok: true, stage: 'filled' }])
    const adapter = noDelay(new NeteaseAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    expect(created[0]).toBe('https://mp.163.com/#/article-publish')
    expect(created[0]).not.toContain('edit.html')
  })

  it('企鹅号抓的是 articlePublish，不是已 404 的 articleEdit', async () => {
    const { runtime, created } = createRuntime([{ ok: true, stage: 'filled' }])
    const adapter = noDelay(new TencentOmAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    expect(created[0]).toContain('articlePublish')
    expect(created[0]).not.toContain('articleEdit')
  })

  it('什么值得买投稿页是 /tougao/，不是 404 的 /publish/', async () => {
    const { runtime, created } = createRuntime([{ ok: true, stage: 'filled' }])
    const adapter = noDelay(new SmzdmAdapter())
    await adapter.init(runtime)

    await adapter.publish(article, { draftOnly: true })

    expect(created[0]).toBe('https://post.smzdm.com/tougao/')
  })

  it('八方 / 黄页88 是多步 B2B 表单：只打开发布页，绝不注入', async () => {
    for (const Adapter of [BafangAdapter, Huangye88Adapter]) {
      const { runtime, created, payloads } = createRuntime([{ ok: true, stage: 'filled' }])
      const adapter = noDelay(new (Adapter as new () => BafangAdapter)())
      await adapter.init(runtime)

      const result = await adapter.publish(article, { draftOnly: true })

      expect(result.success).toBe(true)
      expect(payloads).toHaveLength(0)
      expect(created).toHaveLength(1)
      expect(adapter.getDiagnostics().manualOnly).toBe(true)
      expect(result.message).toContain('分类')
    }
    // 黄页88 指向真正的发布页，而不是会员中心首页
    const { runtime, created } = createRuntime([{ ok: true, stage: 'filled' }])
    const huangye = noDelay(new Huangye88Adapter())
    await huangye.init(runtime)
    await huangye.publish(article, { draftOnly: true })
    expect(created[0]).toBe('https://fabuxinxi.huangye88.com/')
  })
})

describe('博客园：ASP.NET antiforgery 双要素', () => {
  it('先要 /api/xsrf，用服务端给的 headerName 与 request 串', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const runtime = {
      type: 'extension',
      fetch: async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/api/xsrf')) {
          return new Response(JSON.stringify({ headerName: 'X-XSRF-TOKEN', request: 'tok-123', cookie: 'c-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ id: 42, url: 'https://www.cnblogs.com/u/p/42' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
      getCookie: async () => null,
      storage: { get: async () => null, set: async () => {}, remove: async () => {} },
      session: { get: async () => null, set: async () => {} },
    } as unknown as RuntimeInterface

    const adapter = new CnblogsAdapter()
    await adapter.init(runtime)
    const result = await adapter.publish(article, { draftOnly: true })

    expect(result.success).toBe(true)
    expect(calls[0].url).toContain('/api/xsrf')
    const post = calls.find(c => c.url.endsWith('/api/posts'))
    expect(post).toBeTruthy()
    const headers = post!.init!.headers as Record<string, string>
    expect(headers['X-XSRF-TOKEN']).toBe('tok-123')
    expect(headers['x-xsrf-token']).toBeUndefined()
  })

  it('取不到 /api/xsrf 时退回 Cookie，并且要 URL 解码', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const runtime = {
      type: 'extension',
      fetch: async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/api/xsrf')) return new Response('nope', { status: 404 })
        return new Response(JSON.stringify({ id: 7 }), { status: 200 })
      },
      cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
      getCookie: async (_domain: string, name: string) => (name === 'XSRF-TOKEN' ? 'abc%3D%3D' : null),
      storage: { get: async () => null, set: async () => {}, remove: async () => {} },
      session: { get: async () => null, set: async () => {} },
    } as unknown as RuntimeInterface

    const adapter = new CnblogsAdapter()
    await adapter.init(runtime)
    await adapter.publish(article, { draftOnly: true })

    const post = calls.find(c => c.url.endsWith('/api/posts'))
    const headers = post!.init!.headers as Record<string, string>
    expect(headers['X-XSRF-TOKEN']).toBe('abc==')
  })
})

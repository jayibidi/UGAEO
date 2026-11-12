import { describe, expect, it } from 'vitest'
import type { Cookie, RuntimeInterface } from '../../runtime/interface'
import { ToutiaoAdapter } from '../platforms/toutiao'

/** 只关心 cookie 查询的最小 runtime */
function createRuntime(cookieMap: Record<string, Cookie[]>): {
  runtime: RuntimeInterface
  calls: string[]
} {
  const calls: string[] = []
  const runtime = {
    type: 'extension',
    fetch: async () => new Response('{}', { status: 200 }),
    cookies: {
      get: async (target: string) => {
        calls.push(target)
        for (const [key, value] of Object.entries(cookieMap)) {
          if (target.includes(key)) return value
        }
        return []
      },
      set: async () => {},
      remove: async () => {},
    },
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    session: {
      get: async () => null,
      set: async () => {},
    },
  } as unknown as RuntimeInterface
  return { runtime, calls }
}

function cookie(name: string, value: string, domain: string): Cookie {
  return { name, value, domain, path: '/' }
}

describe('页面驱动平台的登录态检测', () => {
  it('用编辑器 URL 查询 Cookie，而不是裸域名', async () => {
    const { runtime, calls } = createRuntime({})
    const adapter = new ToutiaoAdapter()
    await adapter.init(runtime)

    await adapter.checkAuth()

    // 必须带协议，否则 chrome.cookies 会把它当域名匹配，永远查不到
    expect(calls[0]).toMatch(/^https:\/\/mp\.toutiao\.com/)
  })

  it('父域 .toutiao.com 上的 sessionid 能识别为已登录', async () => {
    const { runtime } = createRuntime({
      'mp.toutiao.com': [
        cookie('ttwid', 'x', '.toutiao.com'),
        cookie('sessionid', 'abc123', '.toutiao.com'),
      ],
    })
    const adapter = new ToutiaoAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
  })

  it('只有匿名 Cookie 时判为未登录，并给出带平台名的提示', async () => {
    const { runtime } = createRuntime({
      'mp.toutiao.com': [cookie('ttwid', 'x', '.toutiao.com')],
    })
    const adapter = new ToutiaoAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('头条号')
  })

  it('sessionid 为空字符串时不算登录', async () => {
    const { runtime } = createRuntime({
      'mp.toutiao.com': [cookie('sessionid', '', '.toutiao.com')],
    })
    const adapter = new ToutiaoAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { Cookie, RuntimeInterface } from '../../runtime/interface'
import { EastmoneyAdapter } from '../platforms/eastmoney'

interface MockOptions {
  cookies?: Record<string, Cookie[]>
  authorInfo?: unknown
  mainUser?: string
  fetchCalls?: string[]
}

function cookie(name: string, value: string, domain: string): Cookie {
  return { name, value, domain, path: '/' }
}

function createRuntime(options: MockOptions): { runtime: RuntimeInterface; calls: string[] } {
  const calls = options.fetchCalls ?? []

  const runtime = {
    type: 'extension',
    fetch: async (url: string) => {
      calls.push(url)
      if (url.includes('getauthorinfo')) {
        return new Response(JSON.stringify(options.authorInfo ?? { Success: -1, Message: '未登录' }), {
          status: 200,
        })
      }
      if (url.includes('UserInfo4jsonp')) {
        return new Response(options.mainUser ?? 'ugaeo_cb({"user_id":null})', { status: 200 })
      }
      return new Response('{}', { status: 200 })
    },
    cookies: {
      get: async (target: string) => {
        const map = options.cookies || {}
        for (const [key, value] of Object.entries(map)) {
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

describe('东方财富登录态检测', () => {
  it('父域 .eastmoney.com 上的 ct/ut 能识别为已登录', async () => {
    const { runtime } = createRuntime({
      cookies: {
        'mp.eastmoney.com': [
          cookie('ct', 'ct-value', '.eastmoney.com'),
          cookie('ut', 'ut-value', '.eastmoney.com'),
        ],
      },
      authorInfo: { Success: 1, Result: { accountId: '9527', accountName: '财富号作者' } },
    })
    const adapter = new EastmoneyAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.username).toBe('财富号作者')
  })

  it('鉴权请求带上创作平台要求的公共参数', async () => {
    const calls: string[] = []
    const { runtime } = createRuntime({
      cookies: {
        'mp.eastmoney.com': [
          cookie('ct', 'ct-value', '.eastmoney.com'),
          cookie('ut', 'ut-value', '.eastmoney.com'),
        ],
      },
      authorInfo: { Success: 1, Result: { accountId: '1', accountName: 'x' } },
      fetchCalls: calls,
    })
    const adapter = new EastmoneyAdapter()
    await adapter.init(runtime)

    await adapter.checkAuth()

    const url = calls.find(u => u.includes('getauthorinfo')) || ''
    expect(url).toContain('product=CFH')
    expect(url).toContain('plat=web')
    expect(url).toContain('ctoken=ct-value')
    expect(url).toContain('utoken=ut-value')
    expect(url).toMatch(/deviceid=[0-9A-F]{32}/)
  })

  it('财富号接口回「未登录」但主站账号有效时，仍判为已登录并给出备注', async () => {
    const { runtime } = createRuntime({
      cookies: {
        'mp.eastmoney.com': [
          cookie('ct', 'ct-value', '.eastmoney.com'),
          cookie('ut', 'ut-value', '.eastmoney.com'),
        ],
      },
      authorInfo: { Success: -1, Message: '未登录' },
      mainUser: 'ugaeo_cb({"user_id":8823,"user_nickname":"东财用户"})',
    })
    const adapter = new EastmoneyAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.username).toBe('东财用户')
    expect(auth.error).toContain('财富号')
  })

  it('Cookie 与主站账号都没有时判为未登录，并说明缺哪个 Cookie', async () => {
    const { runtime } = createRuntime({ cookies: {} })
    const adapter = new EastmoneyAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('东方财富')
    expect(auth.error).toContain('ct')
  })

  it('同名 Cookie 有多个时优先取域名更具体的那个', async () => {
    const calls: string[] = []
    const { runtime } = createRuntime({
      cookies: {
        'mp.eastmoney.com': [
          cookie('ct', 'stale', 'eastmoney.com'),
          cookie('ct', 'fresh', 'mp.eastmoney.com'),
          cookie('ut', 'ut-value', '.eastmoney.com'),
        ],
      },
      authorInfo: { Success: 1, Result: { accountId: '1', accountName: 'x' } },
      fetchCalls: calls,
    })
    const adapter = new EastmoneyAdapter()
    await adapter.init(runtime)

    await adapter.checkAuth()
    expect(calls.find(u => u.includes('getauthorinfo'))).toContain('ctoken=fresh')
  })
})

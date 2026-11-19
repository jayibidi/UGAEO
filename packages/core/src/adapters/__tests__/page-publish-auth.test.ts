import { describe, expect, it } from 'vitest'
import type { Cookie, RuntimeInterface } from '../../runtime/interface'
import { ToutiaoAdapter } from '../platforms/toutiao'
import { HuxiuAdapter, JiemianAdapter, TencentOmAdapter } from '../platforms/news-portals'
import { ShunqiAdapter } from '../platforms/b2b-directory'
import { InfoqAdapter } from '../platforms/submission-draft'

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
        const entry = Object.entries(cookieMap).find(([key]) => target.includes(key))
        const list = entry ? entry[1] : []
        // 模拟 chrome.cookies：URL 查询只返回真的会发给这个地址的 Cookie（含父域）
        if (!target.includes('://')) return list
        const host = new URL(target).hostname
        return list.filter(c => {
          const d = c.domain.replace(/^\./, '')
          return host === d || host.endsWith(`.${d}`)
        })
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

function cookie(name: string, value: string, domain: string, over: Partial<Cookie> = {}): Cookie {
  return { name, value, domain, path: '/', ...over }
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

describe('登录态检测 · 名字对不上时的兜底', () => {
  it('Cookie 名不在白名单，但存在 httpOnly 会话 Cookie → 已登录', async () => {
    const { runtime } = createRuntime({
      '11467.com': [cookie('member_ticket_v3', 'x', '.11467.com', { httpOnly: true })],
    })
    const adapter = new ShunqiAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('名字带会话关键词的非 httpOnly Cookie 也算', async () => {
    const { runtime } = createRuntime({
      '11467.com': [cookie('qy_login_ticket', 'x', '.11467.com', { httpOnly: false })],
    })
    const adapter = new ShunqiAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('统计 / 反爬 / 通用会话 ID 一律不当成登录态', async () => {
    const { runtime } = createRuntime({
      '11467.com': [
        cookie('_ga', '1', '.11467.com', { httpOnly: false }),
        cookie('Hm_lvt_abc', '1', '.11467.com', { httpOnly: false }),
        cookie('__jsluid_h', '1', '.11467.com', { httpOnly: true }),
        cookie('acw_sc__v2', '1', '.11467.com', { httpOnly: true }),
        cookie('__cf_bm', '1', '.11467.com', { httpOnly: true }),
        cookie('JSESSIONID', '1', '.11467.com', { httpOnly: true }),
        cookie('ASP.NET_SessionId', '1', '.11467.com', { httpOnly: true }),
        cookie('SERVERID', '1', '.11467.com', { httpOnly: true }),
      ],
    })
    const adapter = new ShunqiAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('11467.com')
  })

  it('过期 Cookie 不算登录态', async () => {
    const { runtime } = createRuntime({
      '11467.com': [
        cookie('member_ticket', 'x', '.11467.com', {
          httpOnly: true,
          expirationDate: Math.floor(Date.now() / 1000) - 60,
        }),
      ],
    })
    const adapter = new ShunqiAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })
})

describe('主域查询不能把别的站点带进来', () => {
  it('查 qq.com 会返回 mp.weixin.qq.com 的 ua_id，不能算企鹅号已登录', async () => {
    const { runtime } = createRuntime({
      'qq.com': [cookie('ua_id', 'x', 'mp.weixin.qq.com', { httpOnly: true })],
    })
    const adapter = new TencentOmAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(false)
  })

  it('主域自己的通行证 Cookie 仍然算（.qq.com 上的 p_skey）', async () => {
    const { runtime } = createRuntime({
      'qq.com': [cookie('p_skey', 'x', '.qq.com', { httpOnly: true })],
    })
    const adapter = new TencentOmAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })
})

describe('多主机平台：登录页与投稿后台分离', () => {
  it('界面新闻登录态在 www.jiemian.com 时也能识别', async () => {
    const { runtime, calls } = createRuntime({
      'https://www.jiemian.com': [cookie('jm_sso_ticket', 'x', '.jiemian.com', { httpOnly: true })],
    })
    const adapter = new JiemianAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
    // 编辑器域、主域、登录页都要查到
    expect(calls.some(c => c.includes('a.jiemian.com'))).toBe(true)
    expect(calls).toContain('jiemian.com')
    expect(calls.some(c => c.includes('www.jiemian.com'))).toBe(true)
  })

  it('界面新闻未登录时，提示指向门户登录页而不是投稿后台', async () => {
    const { runtime } = createRuntime({})
    const adapter = new JiemianAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('https://www.jiemian.com')
  })

  it('虎嗅入口与登录页都在 mp.huxiu.com', async () => {
    const { runtime: _runtime } = createRuntime({})
    const diag = new HuxiuAdapter().getDiagnostics()
    expect(diag.entryUrl).toContain('mp.huxiu.com')
    expect(diag.loginUrl).toBe('https://mp.huxiu.com')
    expect(diag.requiresAuth).toBe(true)
  })
})

describe('InfoQ 不再标成「无需登录」', () => {
  it('作者登录后判定为已登录，且不是 public', async () => {
    const { runtime } = createRuntime({
      'xie.infoq.cn': [cookie('infoq_token', 'x', '.infoq.cn', { httpOnly: true })],
    })
    const adapter = new InfoqAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.authMode).not.toBe('public')
  })

  it('未登录时给出写作社区登录地址', async () => {
    const { runtime } = createRuntime({})
    const adapter = new InfoqAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('https://xie.infoq.cn')
  })

  it('入口直达创作台', () => {
    const diag = new InfoqAdapter().getDiagnostics()
    expect(diag.entryUrl).toBe('https://xie.infoq.cn/application')
    expect(diag.requiresAuth).toBe(true)
  })
})

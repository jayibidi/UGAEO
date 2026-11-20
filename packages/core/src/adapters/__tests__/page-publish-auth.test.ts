import { describe, expect, it } from 'vitest'
import type { Cookie, RuntimeInterface } from '../../runtime/interface'
import { ToutiaoAdapter } from '../platforms/toutiao'
import { HuxiuAdapter, JiemianAdapter, TencentOmAdapter } from '../platforms/news-portals'
import { BafangAdapter } from '../platforms/b2b-directory'
import { InfoqAdapter, IthomeAdapter, KuaidongAdapter } from '../platforms/submission-draft'

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
      'b2b168.com': [cookie('member_ticket_v3', 'x', '.b2b168.com', { httpOnly: true })],
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('名字带会话关键词的非 httpOnly Cookie 也算', async () => {
    const { runtime } = createRuntime({
      'b2b168.com': [cookie('qy_login_ticket', 'x', '.b2b168.com', { httpOnly: false })],
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('统计 / 反爬 / 通用会话 ID 一律不当成登录态', async () => {
    const { runtime } = createRuntime({
      'b2b168.com': [
        cookie('_ga', '1', '.b2b168.com', { httpOnly: false }),
        cookie('Hm_lvt_abc', '1', '.b2b168.com', { httpOnly: false }),
        cookie('__jsluid_h', '1', '.b2b168.com', { httpOnly: true }),
        cookie('acw_sc__v2', '1', '.b2b168.com', { httpOnly: true }),
        cookie('__cf_bm', '1', '.b2b168.com', { httpOnly: true }),
        cookie('JSESSIONID', '1', '.b2b168.com', { httpOnly: true }),
        cookie('ASP.NET_SessionId', '1', '.b2b168.com', { httpOnly: true }),
        cookie('SERVERID', '1', '.b2b168.com', { httpOnly: true }),
      ],
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    // 提示必须指向真正有登录入口的地址（八方的登录页是 m.b2b168.com/?pg=login）
    expect(auth.error).toContain('b2b168.com')
  })

  it('过期 Cookie 不算登录态', async () => {
    const { runtime } = createRuntime({
      'b2b168.com': [
        cookie('member_ticket', 'x', '.b2b168.com', {
          httpOnly: true,
          expirationDate: Math.floor(Date.now() / 1000) - 60,
        }),
      ],
    })
    const adapter = new BafangAdapter()
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

  it('虎嗅入口在创作者后台，去登录送到门户 www.huxiu.com', async () => {
    const diag = new HuxiuAdapter().getDiagnostics()
    expect(diag.entryUrl).toContain('mp.huxiu.com')
    // mp 是后台，未登录进去只有空白；门户才有登录入口
    expect(diag.loginUrl).toBe('https://www.huxiu.com')
    expect(diag.requiresAuth).toBe(true)
  })

  it('虎嗅未登录时，提示指向 www.huxiu.com', async () => {
    const { runtime } = createRuntime({})
    const adapter = new HuxiuAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('https://www.huxiu.com')
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

/** 带标签页能力的最小 runtime：用于验证「打开页面实测登录态」 */
function createProbeRuntime(opts: {
  /** 打开后最终停留的地址 */
  finalUrl: string
  /** 页面正文 */
  text?: string
  cookies?: Record<string, Cookie[]>
  fail?: boolean
}): { runtime: RuntimeInterface; opened: string[]; removed: number[] } {
  const opened: string[] = []
  const removed: number[] = []
  const base = createRuntime(opts.cookies ?? {}).runtime
  const runtime = {
    ...base,
    tabs: {
      query: async () => [],
      create: async (url: string) => {
        if (opts.fail) throw new Error('cannot open tab')
        opened.push(url)
        return { id: 7 }
      },
      waitForLoad: async () => {},
      executeScript: async () => ({ url: opts.finalUrl, text: opts.text ?? '' }),
      remove: async (tabId: number) => {
        removed.push(tabId)
      },
    },
  } as unknown as RuntimeInterface
  return { runtime, opened, removed }
}

describe('登录态实测：靠页面判断，不靠猜 Cookie 名', () => {
  it('八方资源网：访客被 301 到 pg=login → 未登录', async () => {
    const { runtime, opened, removed } = createProbeRuntime({
      finalUrl: 'https://mw.b2b168.com/Index.aspx?pg=login&url=x',
      text: '登录 - 八方资源网',
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toContain('八方资源网')
    expect(opened[0]).toContain('mw.b2b168.com/Index.aspx')
    // 探针标签页必须关掉，不能留在用户窗口里
    expect(removed).toEqual([7])
  })

  it('八方资源网：停在会员中心且出现「退出」→ 已登录（即使 Cookie 一个都对不上）', async () => {
    const { runtime } = createProbeRuntime({
      finalUrl: 'https://mw.b2b168.com/Index.aspx',
      text: '会员中心 您好，某某公司 退出',
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('快懂百科：/create 被重定向到 /login → 未登录', async () => {
    const { runtime } = createProbeRuntime({
      finalUrl: 'https://www.baike.com/login?redirect_url=https%3A%2F%2Fwww.baike.com%2Fcreate',
      text: '登录',
    })
    const adapter = new KuaidongAdapter()
    await adapter.init(runtime)

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.authMode).not.toBe('public')
  })

  it('实测打不开标签页时，退回 Cookie 判定而不是直接判未登录', async () => {
    const { runtime } = createProbeRuntime({
      finalUrl: 'about:blank',
      fail: true,
      cookies: { 'b2b168.com': [cookie('member_ticket', 'x', '.b2b168.com', { httpOnly: true })] },
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
  })

  it('登录页与后台不同子域时，两边的 Cookie 都要查', async () => {
    const { runtime, calls } = createRuntime({
      'm.b2b168.com': [cookie('member_ticket', 'x', 'm.b2b168.com', { httpOnly: true })],
    })
    const adapter = new BafangAdapter()
    await adapter.init(runtime)

    expect((await adapter.checkAuth()).isAuthenticated).toBe(true)
    // 后台是 mw.b2b168.com、登录页是 m.b2b168.com，只查后台会把登录票据漏掉
    expect(calls.some(c => c.includes('mw.b2b168.com'))).toBe(true)
    expect(calls.some(c => c.includes('m.b2b168.com'))).toBe(true)
  })
})

describe('没有编辑器的平台不再谎报「无需登录」', () => {
  it('IT之家：需要登录，只到草稿层，入口是投稿说明页', () => {
    const diag = new IthomeAdapter().getDiagnostics()
    expect(diag.requiresAuth).toBe(true)
    expect(diag.manualOnly).toBe(true)
    expect(diag.entryUrl).toContain('dyn.ithome.com/tougao')
    expect(diag.loginUrl).toBe('https://www.ithome.com')
  })

  it('IT之家：不声明 publish 能力（无法一键发文）', () => {
    const caps = new IthomeAdapter().meta.capabilities
    expect(caps).toContain('draft')
    expect(caps).not.toContain('publish')
  })

  it('快懂百科：需要登录，不是 public', () => {
    const diag = new KuaidongAdapter().getDiagnostics()
    expect(diag.requiresAuth).toBe(true)
    expect(new KuaidongAdapter().meta.capabilities).not.toContain('publish')
  })
})

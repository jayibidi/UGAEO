/**
 * 微信公众号登录态
 *
 * 首页是「未登录也能拿到」的页面，里面同时含 `t: "https://res.wx.qq.com/..."` 这种资源地址，
 * 只匹配 t 会把游客判成已登录 —— 这正是上一版账号页「2/31 可用」的来源之一。
 */
import { describe, expect, it } from 'vitest'
import type { RuntimeInterface } from '../../runtime/interface'
import { WeixinAdapter } from '../platforms/weixin'

function runtimeWithHtml(html: string): RuntimeInterface {
  return {
    type: 'extension',
    fetch: async () => new Response(html, { status: 200 }),
    cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    session: { get: async () => null, set: async () => {} },
  } as unknown as RuntimeInterface
}

/** 未登录首页的关键片段：t 是资源地址，user_name 为空 */
const LOGGED_OUT_HTML = `
<script>
  var cfg = { data: {
    t: "https://res.wx.qq.com/mpres/zh_CN/htmledition/",
    ticket: "",
    user_name: "",
    nick_name: "",
    time: "1795538000",
  };
</script>
`

/** 登录后的关键片段：t 是数字 token，user_name 是 gh_ 开头的原始 id */
const LOGGED_IN_HTML = `
<script>
  var cfg = { data: {
    t: "1795538000",
    ticket: "v2_abc123",
    user_name: "gh_1234567890ab",
    nick_name: "我的公众号",
    time: "1795538000",
    head_img: "https://wx.qlogo.cn/x.png",
  };
</script>
`

describe('微信公众号登录态检测', () => {
  it('未登录首页不能判成已登录（t 只是资源地址）', async () => {
    const adapter = new WeixinAdapter()
    await adapter.init(runtimeWithHtml(LOGGED_OUT_HTML))

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('真 token + user_name 才算登录', async () => {
    const adapter = new WeixinAdapter()
    await adapter.init(runtimeWithHtml(LOGGED_IN_HTML))

    const auth = await adapter.checkAuth()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.userId).toBe('gh_1234567890ab')
    expect(auth.username).toBe('我的公众号')
  })
})

/**
 * 适配器一致性体检
 *
 * 目的不是测业务逻辑，而是把「肉眼很难发现、但一定会在用户机器上翻车」的配置错误
 * 变成可回归的断言：
 *
 *  - 新加的平台忘了登记到平台档案 → 账号页没有标签、分组里凭空少一个
 *  - 页面驱动平台的 editorUrl 与 editorUrlMatch 对不上 → 永远找不到已打开的编辑器，
 *    每次都新开一个标签页（用户看到「开了一堆后台页」）
 *  - requiresAuth 但没给 sessionCookieNames → 永远判未登录，等于平台不可用
 *  - submission 模式却声明了 publish 能力 → 标签说「可直发」，实际只能人工提交
 *  - 入口地址不是 https / 明显写错 → 打开就是 404 或安全警告
 */
import { describe, expect, it } from 'vitest'
import { BUILT_IN_ADAPTERS } from '../platforms'
import { PLATFORM_PROFILES, resolvePublishLayer } from '../platform-profiles'
import type { PlatformAdapter } from '../types'

/** 无参实例化，拿到 meta 与自检信息（这两个都是构造函数里的静态配置） */
function instantiate(Ctor: new () => PlatformAdapter): PlatformAdapter {
  return new Ctor()
}

const adapters = BUILT_IN_ADAPTERS.map(Ctor => instantiate(Ctor))
const ids = adapters.map(a => a.meta.id)

/** 本地工具型「平台」：不发内容到外站，没有主页也正常 */
const LOCAL_TOOLS = new Set(['zip-download'])

describe('适配器清单', () => {
  it('平台数量与 id 唯一性', () => {
    expect(adapters.length).toBeGreaterThanOrEqual(35)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个平台都有名称、主页与能力声明', () => {
    for (const adapter of adapters) {
      expect(adapter.meta.name, `${adapter.meta.id} 缺少名称`).toBeTruthy()
      if (!LOCAL_TOOLS.has(adapter.meta.id)) {
        expect(adapter.meta.homepage, `${adapter.meta.id} 缺少主页`).toBeTruthy()
      }
      expect(adapter.meta.capabilities?.length, `${adapter.meta.id} 缺少 capabilities`).toBeTruthy()
      expect(adapter.meta.capabilities, `${adapter.meta.id} 应至少支持 article`).toContain('article')
    }
  })
})

describe('平台档案与适配器必须一一对应', () => {
  it('每个适配器都在平台档案里登记（否则账号页无标签、不进分组）', () => {
    const missing = ids.filter(id => !PLATFORM_PROFILES[id])
    expect(missing, `未登记的平台：${missing.join(', ')}`).toEqual([])
  })

  it('平台档案里没有指向不存在适配器的条目', () => {
    const orphan = Object.keys(PLATFORM_PROFILES).filter(id => !ids.includes(id))
    expect(orphan, `档案里多余的平台：${orphan.join(', ')}`).toEqual([])
  })

  it('档案里的内容形态只能是 graphic / news', () => {
    const bad = Object.entries(PLATFORM_PROFILES)
      .filter(([, profile]) => !['graphic', 'news'].includes(profile.kind))
      .map(([id, profile]) => `${id}: ${profile.kind}`)
    expect(bad, bad.join('；')).toEqual([])
  })

  it('层级推导结果只能是 direct / draft', () => {
    for (const adapter of adapters) {
      const layer = resolvePublishLayer(adapter.meta)
      expect(['direct', 'draft']).toContain(layer)
    }
  })
})

describe('页面驱动平台的自检配置', () => {
  const pageAdapters = adapters.filter(a => a.getDiagnostics?.()?.driver === 'page')

  it('至少覆盖了页面驱动的平台（否则这里等于没测）', () => {
    expect(pageAdapters.length).toBeGreaterThan(0)
  })

  it('editorUrlMatch 必须出现在 editorUrl 里（否则永远找不到已开的标签页）', () => {
    // ensureEditorTab 的判断是 tab.url.includes(editorUrlMatch)：
    // 片段对不上就会每次新开一个标签页，用户会看到后台堆积几十个编辑器
    const broken: string[] = []
    for (const adapter of pageAdapters) {
      const diag = adapter.getDiagnostics!()
      const match = diag.entryUrlMatch || ''
      if (match.length < 3) {
        broken.push(`${adapter.meta.id}: editorUrlMatch 过短（"${match}"），会误匹配其它标签页`)
      } else if (!diag.entryUrl!.includes(match)) {
        broken.push(`${adapter.meta.id}: "${match}" 不在 ${diag.entryUrl} 里`)
      }
    }
    expect(broken, broken.join('；')).toEqual([])
  })

  it('入口地址必须是 https', () => {
    const notHttps = pageAdapters
      .filter(a => !a.getDiagnostics!().entryUrl!.startsWith('https://'))
      .map(a => a.meta.id)
    expect(notHttps, `非 https 入口：${notHttps.join(', ')}`).toEqual([])
  })

  it('需要登录的平台必须给出 Cookie 名（否则永远判未登录）', () => {
    const broken = pageAdapters
      .filter(a => {
        const diag = a.getDiagnostics!()
        return diag.requiresAuth && diag.authCookieNames.length === 0
      })
      .map(a => a.meta.id)
    expect(broken, `requiresAuth 但没有 Cookie 名：${broken.join(', ')}`).toEqual([])
  })

  it('投稿型（submission）平台不得声明 publish 能力', () => {
    const broken = pageAdapters
      .filter(a => a.getDiagnostics!().mode === 'submission')
      .filter(a => a.meta.capabilities?.includes('publish'))
      .map(a => a.meta.id)
    expect(broken, `submission 却声称可直发：${broken.join(', ')}`).toEqual([])
  })

  it('公开投稿表单返回「无需登录」而不是「已登录」', async () => {
    const publicAdapters = pageAdapters.filter(a => a.getDiagnostics!().requiresAuth === false)
    expect(publicAdapters.length, '应当存在无需登录的投稿型平台').toBeGreaterThan(0)

    for (const adapter of publicAdapters) {
      const auth = await adapter.checkAuth()
      // 仍然可用（isAuthenticated=true），但必须标出来源，界面才能显示「无需登录」
      expect(auth.isAuthenticated, `${adapter.meta.id} 应可用`).toBe(true)
      expect(auth.authMode, `${adapter.meta.id} 谎报已登录`).toBe('public')
    }
  })

  it('需要登录的平台不得返回 authMode=public', async () => {
    const needsLogin = pageAdapters.filter(a => a.getDiagnostics!().requiresAuth)
    for (const adapter of needsLogin) {
      // 走 Cookie 分支，没有 runtime 会抛错，但绝不能返回 public
      const auth = await adapter.checkAuth().catch(() => ({ isAuthenticated: false, authMode: undefined }))
      expect(auth.authMode, `${adapter.meta.id} 不应声称无需登录`).not.toBe('public')
    }
  })

  it('编辑器型平台必须提供标题 / 正文 / 发布按钮选择器', () => {
    const broken: string[] = []
    for (const adapter of pageAdapters) {
      const diag = adapter.getDiagnostics!()
      if (diag.mode === 'submission') continue
      if (!diag.titleSelectors?.length) broken.push(`${adapter.meta.id}: 缺标题选择器`)
      if (!diag.editorSelectors?.length) broken.push(`${adapter.meta.id}: 缺正文选择器`)
      if (!diag.publishTexts?.length) broken.push(`${adapter.meta.id}: 缺发布按钮文案`)
    }
    expect(broken, broken.join('；')).toEqual([])
  })
})

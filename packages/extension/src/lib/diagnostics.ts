/**
 * 平台自检
 *
 * 目的：在没有真实账号的情况下，也能回答「这个平台到底通不通、哪里有坑」。
 *
 * 分两级：
 * - 轻量体检（diagnosePlatforms）：不发网络请求，只比对适配器声明与登录态，
 *   秒级出结果。能抓到「声明了 publish 却只能人工提交」「需要登录却没配 Cookie 名」
 *   这类配置级问题。
 * - 深度体检（probePlatform）：在后台静默打开平台入口页，统计标题 / 正文 / 发布按钮
 *   选择器的命中情况，抓「页面改版导致填充失效」这类只有真机才能发现的问题。
 *   每体检一个平台开一个标签页，用完即关。
 */
import { getPlatformProfile, resolvePublishLayer } from '@ugaeo/core'
import type { AdapterDiagnostics } from '@ugaeo/core'
import { initAdapters, getAdapter, checkAllPlatformsAuth, getAllPlatformMetas } from '../adapters'
import { createLogger } from './logger'

const logger = createLogger('Diagnostics')

export type DiagnosisLevel = 'ok' | 'warn' | 'error'

export interface PlatformDiagnosis {
  id: string
  name: string
  homepage: string
  capabilities: string[]
  layer: 'direct' | 'draft'
  kind: string
  driver: 'api' | 'page'
  requiresAuth: boolean
  authMode?: 'cookie' | 'public'
  isAuthenticated: boolean
  username?: string
  entryUrl?: string
  mode?: 'editor' | 'submission'
  /** 适配器声明的登录 Cookie 名 */
  cookieNames: string[]
  /** 当前浏览器里实际命中到的 Cookie 名 */
  foundCookies: string[]
  issues: string[]
  level: DiagnosisLevel
}

export interface PageProbeResult {
  ok: boolean
  /** 是否跳过（API 类平台没有页面可探） */
  skipped?: boolean
  reason?: string
  finalUrl?: string
  pageTitle?: string
  loginWall?: boolean
  titleHit?: boolean
  editorHit?: boolean
  publishHit?: boolean
  counts?: Array<{ group: string; selector: string; hit: number }>
  issues: string[]
  level: DiagnosisLevel
}

function levelOf(issues: string[]): DiagnosisLevel {
  if (issues.some(i => i.startsWith('✖'))) return 'error'
  if (issues.length > 0) return 'warn'
  return 'ok'
}

/** 轻量体检：所有平台，不发网络请求 */
export async function diagnosePlatforms(): Promise<PlatformDiagnosis[]> {
  // 必须先注册适配器，否则 getAllPlatformMetas() 拿到空数组，自检页一片空白
  await initAdapters()
  const metas = getAllPlatformMetas()
  const authList = await checkAllPlatformsAuth(false)
  const authMap = new Map(authList.map(item => [item.id, item]))
  const results: PlatformDiagnosis[] = []

  for (const meta of metas) {
    const issues: string[] = []
    const adapter = await getAdapter(meta.id)
    const diag: AdapterDiagnostics = adapter?.getDiagnostics?.() ?? {
      driver: 'api',
      requiresAuth: true,
      authCookieNames: [],
    }

    const auth = authMap.get(meta.id)
    const isAuthenticated = !!auth?.isAuthenticated
    const authMode = auth?.authMode

    // ── 配置级问题（不看网络，纯逻辑矛盾） ──
    if (!diag.requiresAuth && authMode && authMode !== 'public') {
      issues.push('✖ 声明无需登录，但登录态返回的不是 public')
    }
    if (diag.requiresAuth && diag.driver === 'page' && diag.authCookieNames.length === 0) {
      issues.push('✖ 需要登录却没给出 Cookie 名，会一直判未登录')
    }
    if (diag.mode === 'submission' && meta.capabilities?.includes('publish')) {
      issues.push('✖ 投稿型平台声明了 publish，界面会谎报「可直发」')
    }
    if (diag.driver === 'page' && !diag.entryUrl) {
      issues.push('✖ 页面驱动平台缺少入口地址')
    }
    if (diag.driver === 'page' && diag.mode === 'editor' && !diag.publishTexts?.length) {
      issues.push('✖ 编辑器型平台缺少发布按钮文案')
    }

    // ── 登录态 ──
    if (diag.requiresAuth && !isAuthenticated) {
      issues.push('未登录（正常，去平台登录后点重新检测）')
    }

    // ── Cookie 实测（只对需要登录的页面驱动平台；API 类平台由适配器自己判断） ──
    const foundCookies: string[] = []
    if (diag.requiresAuth && diag.driver === 'page' && diag.entryUrl) {
      try {
        const cookies = await chrome.cookies.getAll({ url: diag.entryUrl })
        for (const name of diag.authCookieNames) {
          if (cookies.some(c => c.name === name && c.value)) foundCookies.push(name)
        }
        if (isAuthenticated && foundCookies.length === 0) {
          issues.push('✖ 登录态说已登录，但入口域查不到声明的 Cookie（缓存可能过期）')
        }
        if (!isAuthenticated && foundCookies.length > 0) {
          issues.push('✖ 查到了登录 Cookie 却判未登录（判断逻辑可能写错）')
        }
      } catch (error) {
        issues.push(`查 Cookie 失败：${(error as Error).message}`)
      }
    }

    const profile = getPlatformProfile(meta.id)
    results.push({
      id: meta.id,
      name: meta.name,
      homepage: meta.homepage,
      capabilities: meta.capabilities ?? [],
      layer: resolvePublishLayer(meta),
      kind: profile.kind,
      driver: diag.driver,
      requiresAuth: diag.requiresAuth,
      authMode,
      isAuthenticated,
      username: auth?.username,
      entryUrl: diag.entryUrl,
      mode: diag.mode,
      cookieNames: diag.authCookieNames,
      foundCookies,
      issues,
      level: levelOf(issues),
    })
  }

  return results
}

/** 在页面里跑的探测脚本（会被序列化注入，不能引用外部变量） */
export function probeEntryPage(payload: {
  titleSelectors: string[]
  editorSelectors: string[]
  publishTexts: string[]
}): {
  url: string
  title: string
  titleHit: boolean
  editorHit: boolean
  publishHit: boolean
  counts: Array<{ group: string; selector: string; hit: number }>
  loginText: boolean
  bodyLength: number
} {
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = window.getComputedStyle(el as HTMLElement)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  const counts: Array<{ group: string; selector: string; hit: number }> = []
  const check = (group: string, selectors: string[]) => {
    let visibleHit = 0
    for (const selector of selectors) {
      let nodes: NodeListOf<Element>
      try {
        nodes = document.querySelectorAll(selector)
      } catch {
        continue
      }
      let visible = 0
      nodes.forEach(node => {
        if (isVisible(node)) visible++
      })
      counts.push({ group, selector, hit: visible })
      visibleHit += visible
    }
    return visibleHit > 0
  }

  const titleHit = check('标题', payload.titleSelectors)
  const editorHit = check('正文', payload.editorSelectors)

  const normalized = payload.publishTexts.map(t => t.replace(/\s+/g, ''))
  let publishHit = false
  if (normalized.length > 0) {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a')
    ).filter(isVisible)
    publishHit = candidates.some(el => {
      const text = (el.textContent || '').replace(/\s+/g, '')
      return normalized.some(target => text === target || (target.length >= 2 && text.includes(target)))
    })
  }

  const bodyText = document.body?.innerText || ''
  const loginText = /请先登录|登录后|扫码登录|账号密码登录|登录即代表/.test(bodyText.slice(0, 3000))

  return {
    url: location.href,
    title: document.title,
    titleHit,
    editorHit,
    publishHit,
    counts,
    loginText,
    bodyLength: bodyText.length,
  }
}

/** 等标签页加载完（load 或超时） */
function waitTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && info.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    const timer = setTimeout(finish, timeoutMs)
    // 已经加载完的情况
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish()
    }).catch(finish)
  })
}

/**
 * 深度体检：后台打开入口页，统计选择器命中情况
 *
 * 注意：会短暂打开一个后台标签页，用完立即关闭。
 * 入口页要求登录时会跳登录页，这一项本身也是有用的结论。
 */
export async function probePlatform(platformId: string): Promise<PageProbeResult> {
  const adapter = await getAdapter(platformId)
  const diag = adapter?.getDiagnostics?.()
  if (!diag || diag.driver !== 'page' || !diag.entryUrl) {
    return {
      ok: true,
      skipped: true,
      reason: '该平台走接口同步，没有可探测的富文本编辑器页面',
      issues: [],
      level: 'ok',
    }
  }

  let tabId: number | undefined
  try {
    const tab = await chrome.tabs.create({ url: diag.entryUrl, active: false })
    tabId = tab.id
    if (!tabId) throw new Error('无法创建标签页')

    await waitTabComplete(tabId, 20000)
    // SPA 需要再等一拍才渲染完表单
    await new Promise(r => setTimeout(r, diag.mode === 'submission' ? 600 : 1200))

    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: probeEntryPage,
      args: [{
        titleSelectors: diag.titleSelectors || [],
        editorSelectors: diag.editorSelectors || [],
        publishTexts: diag.publishTexts || [],
      }],
    })

    const probe = result?.result
    if (!probe) throw new Error('页面探测没有返回结果')

    const issues: string[] = []
    const finalUrl = probe.url
    const wentToLogin =
      /login|signin|passport|sso/i.test(finalUrl) || probe.loginText

    if (wentToLogin && diag.requiresAuth) {
      issues.push('入口页要求登录，先在该站登录再体检这部分')
    }
    if (!probe.titleHit) {
      issues.push('✖ 标题选择器一个都没命中（页面改版或需要登录）')
    }
    if (!probe.editorHit) {
      issues.push('✖ 正文选择器一个都没命中（页面改版或需要登录）')
    }
    if (diag.mode === 'editor' && !probe.publishHit) {
      issues.push('没找到发布按钮，同步会降级为「填好内容等手动发」')
    }
    if (probe.bodyLength < 200 && !wentToLogin) {
      issues.push('页面内容过少，可能是 404 / 空壳页')
    }

    return {
      ok: true,
      finalUrl,
      pageTitle: probe.title,
      loginWall: wentToLogin,
      titleHit: probe.titleHit,
      editorHit: probe.editorHit,
      publishHit: probe.publishHit,
      counts: probe.counts,
      issues,
      level: levelOf(issues),
    }
  } catch (error) {
    logger.debug('probe failed:', (error as Error).message)
    return {
      ok: false,
      issues: [`✖ 探测失败：${(error as Error).message}`],
      level: 'error',
    }
  } finally {
    if (tabId !== undefined) {
      chrome.tabs.remove(tabId).catch(() => {})
    }
  }
}

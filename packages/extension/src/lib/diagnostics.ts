/**
 * 平台自检（采集层）
 *
 * 分两级：
 * - 轻量体检（diagnosePlatforms）：不发网络请求，比对适配器声明、方法实现与登录态，
 *   秒级出结果。抓「声明能直发其实没实现」「需要登录却查不到 Cookie」这类矛盾。
 * - 深度体检（probePlatform）：后台打开平台入口页 → 判断登录 → 按 entrySteps 点进编辑器
 *   → 轮询等标题/正文/发布按钮 → 可选试填验证 → 逐项给结论，用完关页。
 *
 * 结论推理放在 diagnose-core.ts（纯函数、可单测），这里只负责把事实采回来。
 */
import { getPlatformProfile, isLocalToolPlatform, resolvePublishLayer } from '@ugaeo/core'
import type { AdapterDiagnostics } from '@ugaeo/core'
import { initAdapters, getAdapter, checkAllPlatformsAuth, checkPlatformAuth, getAllPlatformMetas } from '../adapters'
import { createLogger } from './logger'
import {
  buildProbeChecks,
  conclusionOf,
  levelOfChecks,
  samePageUrl,
  type EntryStepTrace,
  type FillTrial,
  type PageProbeRaw,
  type PageProbeResult,
  type PlatformDiagnosis,
  type SelectorHit,
} from './diagnose-core'

export type {
  CheckStatus,
  DiagnosisLevel,
  EntryStepTrace,
  FillTrial,
  PageProbeRaw,
  PageProbeResult,
  PlatformDiagnosis,
  ProbeCheck,
  SelectorHit,
} from './diagnose-core'

const logger = createLogger('Diagnostics')

/** 等编辑器挂载的默认超时：头条/小红书这类重 SPA 要 5～10 秒 */
const DEFAULT_WAIT_MS = 20000

export interface DiagnoseOptions {
  /** 强制刷新登录态（跳过 30s/5min 缓存） */
  forceRefresh?: boolean
}

/**
 * 轻量体检：所有平台，不发网络请求（只读 Cookie / 缓存）
 */
export async function diagnosePlatforms(options: DiagnoseOptions = {}): Promise<PlatformDiagnosis[]> {
  // 必须先注册适配器，否则 getAllPlatformMetas() 拿到空数组，自检页一片空白
  await initAdapters()
  const metas = getAllPlatformMetas()
  if (metas.length === 0) {
    logger.error('适配器注册后仍为空，检查 BUILT_IN_ADAPTERS 是否被正确打包')
    return []
  }

  // 登录态一次批量取（内部并行 + 缓存），避免每个平台各查一遍
  let authList: Array<{
    id: string
    isAuthenticated?: boolean
    username?: string
    authMode?: 'cookie' | 'public'
  }> = []
  let authError: string | null = null
  try {
    authList = await checkAllPlatformsAuth(options.forceRefresh ?? false)
  } catch (error) {
    authError = (error as Error).message
    logger.error('批量登录态检查失败:', authError)
  }
  const authMap = new Map(authList.map(item => [item.id, item]))

  const results: PlatformDiagnosis[] = []

  for (const meta of metas) {
    if (isLocalToolPlatform(meta.id)) continue
    const issues: string[] = []
    try {
      const adapter = await getAdapter(meta.id)
      const diag: AdapterDiagnostics = adapter?.getDiagnostics?.() ?? {
        driver: 'api',
        requiresAuth: true,
        authCookieNames: [],
      }

      const auth = authMap.get(meta.id)
      const isAuthenticated = !!auth?.isAuthenticated
      const authMode = auth?.authMode
      const capabilities = meta.capabilities ?? []
      const layer = resolvePublishLayer(meta)

      // ── 配置级问题（纯逻辑矛盾，不看网络） ──
      if (!adapter) {
        issues.push('✖ 适配器没注册成功（BUILT_IN_ADAPTERS 里可能漏了）')
      }
      if (!diag.requiresAuth && authMode && authMode !== 'public') {
        issues.push('✖ 声明无需登录，但登录态返回的不是 public')
      }
      if (diag.requiresAuth && diag.driver === 'page' && diag.authCookieNames.length === 0) {
        issues.push('✖ 需要登录却没给出 Cookie 名，会一直判未登录')
      }
      if (diag.mode === 'submission' && capabilities.includes('publish')) {
        issues.push('✖ 投稿型平台声明了 publish，界面会谎报「可直发」')
      }
      if (diag.driver === 'page' && !diag.entryUrl) {
        issues.push('✖ 页面驱动平台缺少入口地址')
      }
      if (diag.driver === 'page' && diag.mode === 'editor' && !diag.publishTexts?.length) {
        issues.push('✖ 编辑器型平台缺少发布按钮文案，永远点不到发布')
      }
      if (capabilities.includes('publish_existing_draft') && !adapter?.publishExistingDraft) {
        issues.push('✖ 声明能从草稿转发布，但没实现 publishExistingDraft()')
      }
      if (diag.manualOnly && capabilities.includes('publish')) {
        issues.push('✖ 标记为纯人工平台却声明了 publish')
      }
      if (diag.driver === 'page' && !diag.titleSelectors?.length) {
        issues.push('✖ 页面驱动平台没有标题选择器，填充必然失败')
      }
      if (diag.driver === 'page' && !diag.editorSelectors?.length && !diag.manualOnly) {
        issues.push('✖ 页面驱动平台没有正文选择器，填充必然失败')
      }

      // ── 登录态 ──
      if (authError) {
        issues.push(`登录态检查整体失败：${authError}`)
      }
      const publiclyOpen = !diag.requiresAuth || authMode === 'public'
      if (diag.requiresAuth && !isAuthenticated) {
        issues.push('未登录（正常，去平台登录后点重新检测）')
      }

      // ── Cookie 实测（只对需要登录的页面驱动平台；API 类由适配器自己判断） ──
      const foundCookies: string[] = []
      if (diag.requiresAuth && diag.driver === 'page' && diag.entryUrl) {
        try {
          const cookies = await chrome.cookies.getAll({ url: diag.entryUrl })
          for (const name of diag.authCookieNames) {
            if (cookies.some(c => c.name === name && c.value)) foundCookies.push(name)
          }
          if (isAuthenticated && foundCookies.length === 0) {
            issues.push('✖ 登录态说已登录，但入口域查不到声明的 Cookie（缓存可能过期，点重新检测）')
          }
          if (!isAuthenticated && foundCookies.length > 0) {
            issues.push('✖ 查到了登录 Cookie 却判未登录（判断逻辑可能写错）')
          }
          // 只命中游客标识（__ckguid 这种）时，登录判断多半是乐观误判
          if (isAuthenticated && foundCookies.length > 0 && foundCookies.every(name => /guid|uuid|visitor|guest/i.test(name))) {
            issues.push(`⚠ 只命中游客标识 Cookie（${foundCookies.join(' / ')}），大概率并没有真正登录，同步前先在浏览器里登录确认`)
          }
        } catch (error) {
          issues.push(`查 Cookie 失败：${(error as Error).message}`)
        }
      }

      const profile = getPlatformProfile(meta.id)
      results.push({
        id: meta.id,
        name: meta.name,
        icon: meta.icon,
        homepage: meta.homepage,
        capabilities,
        layer,
        kind: profile.kind,
        driver: diag.driver,
        requiresAuth: diag.requiresAuth,
        authMode,
        isAuthenticated,
        username: auth?.username,
        entryUrl: diag.entryUrl,
        mode: diag.mode,
        manualOnly: diag.manualOnly,
        cookieNames: diag.authCookieNames,
        foundCookies,
        conclusion: conclusionOf({
          manualOnly: diag.manualOnly,
          layer,
          isAuthenticated: isAuthenticated || publiclyOpen,
          requiresAuth: diag.requiresAuth,
          authMode,
        }),
        issues,
        level: issues.some(i => i.startsWith('✖')) ? 'error' : issues.length > 0 ? 'warn' : 'ok',
      })
    } catch (error) {
      // 单个平台炸掉不能拖垮整页 —— 以前这里没有 try/catch，一个异常整张表就空白
      logger.error(`体检 ${meta.id} 失败:`, error)
      results.push({
        id: meta.id,
        name: meta.name,
        icon: meta.icon,
        homepage: meta.homepage,
        capabilities: meta.capabilities ?? [],
        layer: 'draft',
        kind: getPlatformProfile(meta.id).kind,
        driver: 'api',
        requiresAuth: true,
        isAuthenticated: false,
        cookieNames: [],
        foundCookies: [],
        conclusion: '未知',
        issues: [`✖ 体检异常：${(error as Error).message}`],
        level: 'error',
      })
    }
  }

  return results
}

interface ProbePayload {
  entryUrl: string
  titleSelectors: string[]
  editorSelectors: string[]
  publishTexts: string[]
  entrySteps: string[][]
  waitMs: number
  dryFill: boolean
}

/** 注入失败时的兜底探测：只回页面自身的状态，用来区分「注入被拦」和「页面跳走了」 */
export const pingPage = (): { url: string; title: string; readyState: string; bodyLength: number } => ({
  url: location.href,
  title: document.title,
  readyState: document.readyState,
  bodyLength: document.body ? (document.body.innerText || '').length : 0,
})

/**
 * 在页面里跑的探测脚本
 *
 * 会被 chrome.scripting.executeScript 序列化后注入，所以：
 * - 不能引用本模块任何变量 / import（一律用页面全局）
 * - 只能是自包含函数表达式，避免打包器插入 __name() 之类的辅助函数
 * - 整个函数体包在 try/catch 里：脚本自己炸掉也要返回一个带 error 的对象，
 *   否则 executeScript 拿到 undefined，外面只能报「注入被拦截？」这种没用的猜测
 */
export const probeEntryPage = async (payload: ProbePayload): Promise<PageProbeRaw> => {
  const startedAt = Date.now()
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

  const snapshot = (): PageProbeRaw => ({
    url: location.href,
    entryUrl: payload.entryUrl,
    redirected: false,
    pageTitle: document.title,
    bodyLength: document.body ? (document.body.innerText || '').length : 0,
    loginWall: false,
    counts: [],
    steps: [],
    editorWritableLikely: false,
    publishHit: false,
    fill: { attempted: false },
    elapsedMs: Date.now() - startedAt,
  })

  try {
    const samePage = (a: string, b: string) => {
      try {
        const ua = new URL(a)
        const ub = new URL(b)
        const normalize = (path: string) => path.replace(/\/+$/, '') || '/'
        return ua.host === ub.host && normalize(ua.pathname) === normalize(ub.pathname)
      } catch {
        return true
      }
    }

    const isVisible = (el: Element | null): boolean => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return false
      const style = window.getComputedStyle(el as HTMLElement)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    const norm = (value: string | null) => (value || '').replace(/\s+/g, '')

    const domSignature = () =>
      `${document.body ? document.body.innerText.length : 0}:${document.querySelectorAll('*').length}`

    const waitFor = async <T,>(fn: () => T | null, timeoutMs: number, interval = 250): Promise<T | null> => {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        const value = fn()
        if (value) return value
        await sleep(interval)
      }
      return fn()
    }

    const depthOf = (el: HTMLElement): number => {
      let depth = 0
      let node: HTMLElement | null = el
      while (node) {
        depth++
        node = node.parentElement
      }
      return depth
    }

    const findClickable = (texts: string[]): HTMLElement | null => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span, li, label')
      ).filter(isVisible)
      for (const text of texts) {
        const target = norm(text)
        if (!target) continue
        const exact = nodes.filter(node => norm(node.textContent) === target)
        if (exact.length > 0) {
          exact.sort((a, b) => depthOf(b) - depthOf(a))
          return exact[0].closest('button, [role="button"], a, li, label') || exact[0]
        }
      }
      for (const text of texts) {
        const target = norm(text)
        if (!target) continue
        const loose = nodes.find(node => {
          const own = norm(node.textContent)
          return own.includes(target) && own.length <= target.length + 8
        })
        if (loose) return loose.closest('button, [role="button"], a, li, label') || loose
      }
      return null
    }

    const firstVisibleOf = (selectors: string[], cache?: Map<string, HTMLElement>): HTMLElement | null => {
      for (const selector of selectors) {
        let nodes: HTMLElement[] = []
        try {
          nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
        } catch {
          continue
        }
        for (const node of nodes) {
          if (isVisible(node)) {
            if (cache) cache.set(selector, node)
            return node
          }
        }
      }
      return null
    }

    const collect = (group: '标题' | '正文', selectors: string[]): SelectorHit[] => {
      const hits: SelectorHit[] = []
      for (const selector of selectors) {
        let matched = 0
        let visible = 0
        try {
          const nodes = Array.from(document.querySelectorAll<Element>(selector))
          matched = nodes.length
          for (const node of nodes) {
            if (isVisible(node)) visible++
          }
        } catch {
          // 选择器语法错误：matched 记 0，明细里能看出来
        }
        hits.push({ group, selector, matched, visible })
      }
      return hits
    }

    const titleSelectors = payload.titleSelectors || []
    const editorSelectors = payload.editorSelectors || []
    const counts: SelectorHit[] = [...collect('标题', titleSelectors), ...collect('正文', editorSelectors)]

    // ── 1. 登录墙 ──
    const passwordField = document.querySelector('input[type="password"]')
    const loginByUrl = /\/login|\/signin|passport|\/sso|\/auth\//i.test(location.href)
    const loginByField = !!passwordField && isVisible(passwordField)
    const loginByText = /扫码登录|账号密码登录|登录后查看|请先登录|登录即代表/.test(
      (document.body ? document.body.innerText : '').slice(0, 3000)
    )
    const loginWall = loginByUrl || loginByField || loginByText
    const loginReason: PageProbeRaw['loginReason'] = loginByUrl
      ? 'url'
      : loginByField
        ? 'password-field'
        : loginByText
          ? 'login-text'
          : undefined

    const base = snapshot()
    base.counts = counts
    base.loginWall = loginWall
    base.loginReason = loginReason
    base.redirected = payload.entryUrl ? !samePage(payload.entryUrl, location.href) : false

    // 登录墙后面什么都没有，硬等 20 秒只会浪费时间，也会把选择器全空误报成「页面改版」
    if (loginWall) return base

    // ── 2. 入口步骤（小红书：写长文 → 新的创作） ──
    // 编辑器已经挂在页面上时，剩下的步骤一律跳过：
    // 头条的「继续编辑」是恢复草稿的提示层，等它 8 秒纯属浪费，还会被误判成失败。
    const editorAlreadyThere = () => Boolean(firstVisibleOf(titleSelectors) && firstVisibleOf(editorSelectors))
    const steps: EntryStepTrace[] = []
    for (const step of payload.entrySteps || []) {
      if (editorAlreadyThere()) {
        steps.push({ text: step[0], clicked: false, waitedMs: 0, skipped: true })
        continue
      }
      const stepStart = Date.now()
      const target = await waitFor(() => findClickable(step), 8000, 300)
      if (!target) {
        steps.push({ text: step[0], clicked: false, waitedMs: Date.now() - stepStart })
        continue
      }
      const before = domSignature()
      try {
        target.click()
      } catch {
        steps.push({ text: step[0], clicked: false, waitedMs: Date.now() - stepStart })
        continue
      }
      // SPA 换路由要一拍：等 DOM 特征变化，最多 6 秒
      await waitFor(() => (domSignature() !== before ? true : null), 6000, 300)
      await sleep(400)
      steps.push({ text: step[0], clicked: true, waitedMs: Date.now() - stepStart })
    }

    // ── 3. 等编辑器挂载（标题 / 正文一起等，页面跳走就立刻收工） ──
    const titleCache = new Map<string, HTMLElement>()
    const editorCache = new Map<string, HTMLElement>()
    let redirectTo: string | undefined
    const deadline = Date.now() + payload.waitMs
    let titleEl: HTMLElement | null = null
    let editorEl: HTMLElement | null = null
    while (Date.now() < deadline) {
      titleEl = firstVisibleOf(titleSelectors, titleCache)
      editorEl = firstVisibleOf(editorSelectors, editorCache)
      if (titleEl && editorEl) break
      if (payload.entryUrl && !samePage(payload.entryUrl, location.href)) {
        redirectTo = location.href
        break
      }
      await sleep(250)
    }
    if (!titleEl) titleEl = firstVisibleOf(titleSelectors, titleCache)
    if (!editorEl) editorEl = firstVisibleOf(editorSelectors, editorCache)

    // ── 4. 发布按钮 ──
    const publishTexts = (payload.publishTexts || []).map(text => norm(text)).filter(Boolean)
    let publishHit = false
    if (publishTexts.length > 0) {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a, [class*="publish"], [class*="submit"]')
      ).filter(isVisible)
      publishHit = candidates.some(el => {
        const text = norm(el.textContent)
        return publishTexts.some(target => text === target || (target.length >= 2 && text.includes(target)))
      })
    }

    // ── 5. 标题/正文是否可写 ──
    const writable = (el: HTMLElement | null): boolean => {
      if (!el) return false
      const tag = el.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') {
        const field = el as HTMLInputElement
        return !field.disabled && !field.readOnly
      }
      return el.getAttribute('contenteditable') === 'true' || el.isContentEditable === true
    }

    // ── 6. 试填写入（可选）：真写一段测试文字再读回来，验证受控组件也认 ──
    const fill: FillTrial = { attempted: false }
    if (payload.dryFill && titleEl && editorEl) {
      fill.attempted = true
      const marker = `UGAEO自检${Math.random().toString(36).slice(2, 6)}`
      try {
        const setNativeValue = (el: HTMLElement, value: string) => {
          const proto = el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
          if (descriptor && descriptor.set) descriptor.set.call(el, value)
          else (el as HTMLInputElement).value = value
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }

        const titleField = titleEl as HTMLInputElement
        if (writable(titleEl)) {
          const originalTitle = titleField.value || ''
          setNativeValue(titleEl, marker)
          await sleep(120)
          fill.titleOk = (titleField.value || '').includes(marker)
          setNativeValue(titleEl, originalTitle)
        }

        const content = editorEl as HTMLElement
        const originalHtml = content.innerHTML
        content.focus()
        let inserted = false
        try {
          inserted = document.execCommand('insertText', false, marker)
        } catch {
          inserted = false
        }
        if (!inserted) {
          content.textContent = marker
          content.dispatchEvent(new Event('input', { bubbles: true }))
        }
        await sleep(200)
        fill.editorOk = (content.innerText || content.textContent || '').includes(marker)

        // 清掉测试文字：不保存、不提交，直接关页；能清则清，清不掉也不影响
        try {
          content.focus()
          document.execCommand('selectAll', false, undefined)
          document.execCommand('delete', false, undefined)
          if ((content.innerText || '').includes(marker)) content.innerHTML = originalHtml
        } catch {
          content.innerHTML = originalHtml
        }
      } catch (error) {
        fill.error = (error as Error).message || String(error)
      }
    }

    return {
      ...base,
      redirected: payload.entryUrl ? !samePage(payload.entryUrl, location.href) : false,
      counts,
      steps,
      titleSelector: titleCache.keys().next().value || undefined,
      editorSelector: editorCache.keys().next().value || undefined,
      editorWritableLikely: writable(editorEl),
      publishHit,
      fill,
      redirectTo,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    return { ...snapshot(), error: (error as Error).message || String(error) }
  }
}

/** 等标签页加载完（load 或超时） */
function waitTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (updatedId: number, tabInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && tabInfo.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    const timer = setTimeout(finish, timeoutMs)
    // 已经加载完的情况（监听器挂上前就 complete 了）
    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') finish()
      })
      .catch(finish)
  })
}

export interface ProbeOptions {
  /** 试填验证：向编辑器写入测试文字再读回（不保存），默认关闭 */
  dryFill?: boolean
  waitMs?: number
  /** 未登录时也强制探测（默认跳过：登录墙后面全是假故障，白开一个标签页） */
  force?: boolean
}

/** 跳过的统一返回，避免每个分支都重复一份 */
function skippedResult(reason: string): PageProbeResult {
  return { ok: true, skipped: true, reason, checks: [], issues: [], level: 'ok' }
}

/**
 * 深度体检：后台打开入口页 → 走入口步骤 → 等编辑器 → 逐项检查
 *
 * 会短暂打开一个后台标签页，用完立即关闭（不点保存，不留草稿）。
 */
export async function probePlatform(
  platformId: string,
  options: ProbeOptions = {}
): Promise<PageProbeResult> {
  const adapter = await getAdapter(platformId)
  const diag = adapter?.getDiagnostics?.()
  if (!diag || diag.driver !== 'page' || !diag.entryUrl) {
    return skippedResult('该平台走接口同步，没有可探测的富文本编辑器页面')
  }

  if (diag.manualOnly) {
    return skippedResult('纯人工平台（没有文章编辑器，只打开入口页），没有可探测的表单')
  }

  // 未登录的平台不必探测：入口页只会把人踢回首页，报出来的全是「选择器过期」这类假故障
  if (diag.requiresAuth && !options.force) {
    const auth = await checkPlatformAuth(platformId).catch(() => ({ isAuthenticated: false }))
    if (!auth.isAuthenticated) {
      return skippedResult(`未登录${diag.authCookieNames.length ? `（缺 ${diag.authCookieNames.join(' / ')}）` : ''}：先在浏览器里登录该站再体检`)
    }
  }

  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS
  let tabId: number | undefined
  try {
    const tab = await chrome.tabs.create({ url: diag.entryUrl, active: false })
    tabId = tab.id
    if (!tabId) throw new Error('无法创建标签页')

    await waitTabComplete(tabId, waitMs)
    // SPA 启动有一拍延迟，注入脚本自己也会轮询，这里只给一点点余量
    await new Promise(resolve => setTimeout(resolve, 500))

    // 浏览器错误页（断网 / 域名解析失败 / 证书错误）不能注入，直接说清楚
    const loaded = await chrome.tabs.get(tabId).catch(() => null)
    if (loaded?.url && /^chrome-error:/.test(loaded.url)) {
      return {
        ok: false,
        finalUrl: loaded.url,
        checks: [],
        issues: [`✖ 入口页打不开（${loaded.url}）：网络不通、需要代理，或该域名已不可用`],
        level: 'error',
      }
    }

    let raw: PageProbeRaw | undefined
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: probeEntryPage,
        args: [
          {
            entryUrl: diag.entryUrl,
            titleSelectors: diag.titleSelectors || [],
            editorSelectors: diag.editorSelectors || [],
            publishTexts: diag.publishTexts || [],
            entrySteps: diag.entrySteps || [],
            waitMs,
            dryFill: options.dryFill === true,
          } satisfies ProbePayload,
        ],
      })
      raw = injection?.result as PageProbeRaw | undefined
    } catch (injectionError) {
      const message = (injectionError as Error).message || String(injectionError)
      // 浏览器自身报「error page」= 这个域名压根没加载出来（DNS / 证书 / 地区限制）
      if (/error page/i.test(message)) {
        return {
          ok: false,
          checks: [],
          issues: [
            `✖ 入口页打不开：浏览器显示的是错误页（${diag.entryUrl}）。域名解析失败、证书错误或被地区限制都可能，先在浏览器里手动打开确认`,
          ],
          level: 'error',
        }
      }
      // 探测途中整页跳走时，注入的 Promise 随上下文一起销毁，executeScript 抛的是
      // "Execution context was destroyed / frame was removed / No tab with id" 这类错误。
      // 这时别报「注入被拦」，先去查标签页现在停在哪。
      if (/context was destroyed|navigation|frame was removed|frame with id|no tab with id/i.test(message)) {
        const after = await chrome.tabs.get(tabId).catch(() => null)
        const nowUrl = after?.url || ''
        if (nowUrl && !samePageUrl(nowUrl, diag.entryUrl)) {
          return {
            ok: false,
            finalUrl: nowUrl,
            checks: [],
            issues: [
              `✖ 探测过程中入口页跳到了 ${nowUrl}（多为未登录被踢走，或入口地址已改版）。先手动打开确认能进编辑器，再回来体检`
            ],
            level: 'error',
          }
        }
        return {
          ok: false,
          checks: [],
          issues: ['✖ 探测途中页面整页刷新了（SPA 重新载入），再点一次「探测」通常就好'],
          level: 'error',
        }
      }
      return {
        ok: false,
        checks: [],
        issues: [`✖ 无法在该页面执行自检脚本：${message}。多数是该页禁止扩展注入（CSP），可以手动打开看实际情况`],
        level: 'error',
      }
    }

    if (!raw) {
      // executeScript 拿到 undefined 只有两种可能：页面整页刷新了，或注入被拦。
      // 与其猜「注入被拦截？」，不如把现场查清楚。
      const after = await chrome.tabs.get(tabId).catch(() => null)
      const nowUrl = after?.url || ''
      const moved = nowUrl && !samePageUrl(nowUrl, diag.entryUrl)
      if (moved) {
        return {
          ok: false,
          finalUrl: nowUrl,
          checks: [],
          issues: [
            `✖ 探测过程中入口页跳到了 ${nowUrl}（多为未登录被踢走，或入口地址已改版）：先在浏览器里手动打开确认能进编辑器`
          ],
          level: 'error',
        }
      }
      const ping = await chrome.scripting
        .executeScript({ target: { tabId }, func: pingPage })
        .then(([r]) => r?.result as { url: string; title: string; bodyLength: number } | undefined)
        .catch(() => undefined)
      if (!ping) {
        return {
          ok: false,
          checks: [],
          issues: ['✖ 页面禁止扩展注入脚本（CSP / 沙箱），自检拿不到结果。可手动打开页面确认，选择器改进走代码'],
          level: 'error',
        }
      }
      return {
        ok: false,
        finalUrl: ping.url,
        pageTitle: ping.title,
        checks: [],
        issues: [
          `✖ 探测没有返回结果，但页面正常（${ping.title || '无标题'} · ${ping.bodyLength} 字）：探测途中整页刷新过，再点一次「探测」通常就好`
        ],
        level: 'error',
      }
    }

    if (raw.redirectTo && !raw.loginWall) {
      logger.debug('probe redirected to', raw.redirectTo)
    }

    const { checks, issues } = buildProbeChecks(raw, {
      requiresAuth: diag.requiresAuth,
      mode: diag.mode,
      entrySteps: diag.entrySteps,
      waitMs,
      entryUrl: diag.entryUrl,
    })

    return {
      ok: true,
      finalUrl: raw.url,
      pageTitle: raw.pageTitle,
      loginWall: raw.loginWall,
      titleHit: !!raw.titleSelector,
      editorHit: !!raw.editorSelector,
      publishHit: raw.publishHit,
      counts: raw.counts,
      steps: raw.steps,
      fill: raw.fill,
      elapsedMs: raw.elapsedMs,
      checks,
      issues,
      level: levelOfChecks(checks),
    }
  } catch (error) {
    logger.debug('probe failed:', (error as Error).message)
    return {
      ok: false,
      checks: [],
      issues: [`✖ 探测失败：${(error as Error).message}`],
      level: 'error',
    }
  } finally {
    if (tabId !== undefined) {
      chrome.tabs.remove(tabId).catch(() => {})
    }
  }
}

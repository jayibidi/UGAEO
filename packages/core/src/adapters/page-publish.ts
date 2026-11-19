/**
 * 页面驱动发布基类
 *
 * 背景：
 * 头条号、小红书这类平台的 Web 接口都带反爬签名（_signature / x-s 等），
 * 签名由页面自己的 JS 生成，在 Service Worker 里无法复现，直接调 API 必然失败。
 *
 * 因此这里换一种策略：打开平台的编辑器页面，在页面上下文（MAIN world）
 * 里把标题、正文填进去，再触发页面的「发布」按钮，让平台自己的代码去完成签名与提交。
 *
 * 三级结果，绝不假装成功：
 * - published：检测到发布成功（URL 跳转 / 成功提示）
 * - submitted：已点击发布但未能确认最终状态
 * - drafted：草稿模式下点到了平台自己的「存草稿」，内容确实落库
 * - filled：内容已填好但没点发布、也没存草稿 → 返回编辑器地址让用户接手
 *
 * 2.5.1 起的关键变化（这版专门修「重 SPA 平台填充失败」）：
 * - 元素一律「轮询等待」而不是查一次：小红书 / 头条的编辑器常常要 5～10 秒才渲染，
 *   以前固定等 2.5 秒就注入，必然查不到标题框，直接判失败。
 * - 进入编辑器前可以配 `entrySteps`（小红书：写长文 → 新的创作），
 *   发布前可以配 `prepareSteps`（小红书长文：一键排版 → 下一步）。
 * - 注入前先判断是不是被踢到登录页，命中就返回 needs_login 并让用户去登录，
 *   而不是报「未找到标题输入框，页面结构可能已变化」这种会误导人的结论。
 * - 草稿模式会点平台自己的「存草稿」，避免内容只活在关掉就丢的编辑器里。
 * - 查不到的组会带 `missing` 返回，便于用户/自检页定位到底哪一段选择器失效。
 */
import { CodeAdapter } from './code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../types'
import type { AdapterDiagnostics, PublishOptions } from './types'
import { createLogger } from '../lib/logger'

const logger = createLogger('PagePublish')

export interface PagePublishConfig {
  /** 判断"已经打开的编辑器 tab"用的 URL 片段 */
  editorUrlMatch: string
  /** 找不到时新建的编辑器地址 */
  editorUrl: string
  /**
   * 登录页地址（可选，默认同 editorUrl）
   *
   * 登录 Cookie 常常写在门户主域上，而不是创作者后台的子域：界面新闻的登录态在
   * `www.jiemian.com`，投稿后台却是 `a.jiemian.com`；虎嗅登录在 `mp.huxiu.com`。
   * 只按 editorUrl 查 Cookie 会漏，表现就是「明明登录了，扩展一直显示未登录」。
   * 配了这里就一起查，错误提示里的地址也换成它 —— 用户照着点过去才能真的登录。
   */
  loginUrl?: string
  /** 标题输入框候选选择器 */
  titleSelectors: string[]
  /** 正文编辑器候选选择器 */
  editorSelectors: string[]
  /** 发布按钮文案（按顺序匹配） */
  publishTexts: string[]
  /** 是否必须有图片（小红书图文这类平台） */
  requireImages?: boolean
  /**
   * 发布形态
   * - editor（默认）：创作者后台的富文本编辑器，能填就能点发布
   * - submission：只有投稿 / 爆料表单，没有发布按钮；填不进去时降级为
   *   「打开投稿页 + 提示手动提交」，而不是报失败
   */
  mode?: 'editor' | 'submission'
  /** 编辑器是重 SPA 时，创建标签页后额外等待的时间（毫秒） */
  extraWaitMs?: number
  /**
   * 进入编辑器前要依次点击的入口
   *
   * 每个元素是一组候选文案（命中任意一个即可），例如小红书的
   * 「写长文」→「新的创作」。找不到时不算失败，继续尝试填内容。
   */
  entrySteps?: string[][]
  /** 发布前必做的整理步骤（小红书长文：一键排版 → 下一步），找不到就跳过 */
  prepareSteps?: string[][]
  /** 草稿模式下点「存草稿」用的文案；不配就不点，只把内容留在编辑器里 */
  draftTexts?: string[]
  /** 发布后的二次确认文案（默认 确定 / 确认发布 / 继续发布） */
  confirmTexts?: string[]
  /** 等待标题框 / 编辑器的上限（毫秒），重 SPA 可调大 */
  waitMs?: number
  /**
   * 纯人工平台：只打开入口页，不注入内容
   *
   * 百科词条、问答这类没有「文章编辑器」的形态，硬填只会把标题写进搜索框。
   * 打开页面 + 说清楚要人工做什么，比假装同步成功诚实。
   */
  manualOnly?: boolean
}

export interface InjectedPublishPayload {
  title: string
  html: string
  images: string[]
  titleSelectors: string[]
  editorSelectors: string[]
  publishTexts: string[]
  draftTexts: string[]
  confirmTexts: string[]
  entrySteps: string[][]
  prepareSteps: string[][]
  requireImages: boolean
  autoPublish: boolean
  waitMs: number
}

export type InjectedStage =
  | 'published'
  | 'submitted'
  | 'drafted'
  | 'filled'
  | 'needs_login'
  | 'failed'

export interface InjectedPublishResult {
  ok: boolean
  stage: InjectedStage
  message?: string
  url?: string
  /** 没命中的环节：title / editor / publish / entry / prepare */
  missing?: string[]
  /** 实际停留的页面地址，便于排查是否被重定向 */
  finalUrl?: string
}

/**
 * 在页面上下文中执行的填充 / 发布脚本
 *
 * 注意：这个函数会被 chrome.scripting.executeScript 序列化后在页面里执行，
 * 因此函数体内不能引用任何外部变量或 import。
 */
export async function injectedPublish(payload: InjectedPublishPayload): Promise<InjectedPublishResult> {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const norm = (value: string | null | undefined) => (value || '').replace(/\s+/g, '')
  const missing: string[] = []

  const isUsable = (el: Element | null): el is HTMLElement => {
    if (!el || !(el instanceof HTMLElement)) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
  }

  /** 在候选选择器里找第一个可用元素（只查一次） */
  const queryFirst = <T extends HTMLElement>(selectors: string[]): T | null => {
    for (const selector of selectors) {
      let nodes: NodeListOf<Element>
      try {
        nodes = document.querySelectorAll(selector)
      } catch {
        continue
      }
      for (const node of Array.from(nodes)) {
        if (isUsable(node)) return node as T
      }
    }
    return null
  }

  /** 轮询等待元素出现：重 SPA 的编辑器常常要好几秒才渲染出来 */
  const waitFor = async <T extends HTMLElement>(
    selectors: string[],
    timeoutMs: number,
    intervalMs = 250
  ): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = queryFirst<T>(selectors)
      if (hit) return hit
      await sleep(intervalMs)
    }
    return null
  }

  /** 是否被重定向到登录页 */
  const looksLikeLogin = (): boolean => {
    const url = location.href
    if (/\/login|signin|passport|\/sso|auth\//i.test(url)) return true
    // 页面上有可见的密码框，基本就是在等人的登录页
    const pwd = document.querySelector<HTMLInputElement>('input[type="password"]')
    return !!pwd && isUsable(pwd)
  }

  /**
   * 按文案找可点击元素
   *
   * 先精确匹配，再退回「包含匹配」：不少平台的按钮是「发布文章」「立即发布」
   * 这类带修饰的词，只做全等会一个都命中不了。但包含匹配要排除
   * 「存草稿 / 定时 / 预览 / 取消」这类会把内容带去别处的按钮。
   */
  const findClickable = (texts: string[], allowDraft = false): HTMLElement | null => {
    const blocks = allowDraft
      ? ['取消', '删除', '设置', '预览', '定时']
      : ['取消', '删除', '设置', '预览', '定时', '草稿', '存草']

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span, li')
    ).filter(node => {
      if (node.getAttribute('aria-disabled') === 'true') return false
      if ((node as HTMLButtonElement).disabled) return false
      return isUsable(node)
    })

    /** 深度：命中同样文案的父子节点里，取最里层那个，点击才落到真正的按钮上 */
    const depthOf = (el: HTMLElement): number => {
      let depth = 0
      let node: HTMLElement | null = el
      while (node) {
        depth++
        node = node.parentElement
      }
      return depth
    }

    for (const text of texts) {
      const target = norm(text)
      if (!target) continue
      const exact = nodes.filter(node => norm(node.textContent) === target)
      if (exact.length > 0) {
        exact.sort((a, b) => depthOf(b) - depthOf(a))
        const hit = exact[0]
        return hit.closest('button, [role="button"], a, li') || hit
      }
    }

    for (const text of texts) {
      const target = norm(text)
      if (!target) continue
      const loose = nodes.find(node => {
        const own = norm(node.textContent)
        if (!own.includes(target)) return false
        // 只接受「比目标文案长一点」的按钮，避免匹配到整块容器
        if (own.length > target.length + 6) return false
        if (blocks.some(word => own.includes(word))) return false
        return true
      })
      if (loose) return loose.closest('button, [role="button"], a, li') || loose
    }

    return null
  }

  /** 等按钮出现再点，返回是否点到 */
  const clickByTexts = async (
    texts: string[],
    opts: { allowDraft?: boolean; timeoutMs?: number } = {}
  ): Promise<boolean> => {
    if (!texts.length) return false
    const deadline = Date.now() + (opts.timeoutMs ?? 3000)
    while (Date.now() < deadline) {
      const el = findClickable(texts, opts.allowDraft ?? false)
      if (el) {
        try {
          el.scrollIntoView({ block: 'center' })
        } catch {
          // 忽略：部分布局不支持 scrollIntoView
        }
        el.click()
        await sleep(500)
        return true
      }
      await sleep(250)
    }
    return false
  }

  /** 受控组件（React）必须走原生 setter 才能触发状态更新 */
  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** contenteditable 的标题（少数平台把标题也做成富文本） */
  const setEditableText = (el: HTMLElement, value: string) => {
    el.focus()
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    try {
      document.execCommand('insertText', false, value)
    } catch {
      el.textContent = value
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
  }

  const textLength = (el: HTMLElement) => (el.innerText || el.textContent || '').replace(/\s+/g, '').length

  /** 把图片塞进 file input（图文平台必需） */
  const uploadImages = async (input: HTMLInputElement, urls: string[]) => {
    const files: File[] = []
    for (const url of urls.slice(0, 9)) {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) continue
        const blob = await response.blob()
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
        files.push(new File([blob], `image-${files.length + 1}.${ext}`, { type: blob.type || 'image/jpeg' }))
      } catch {
        // 单张失败不阻塞整体
      }
    }
    if (files.length === 0) return 0

    const transfer = new DataTransfer()
    files.forEach(file => transfer.items.add(file))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return files.length
  }

  // ── 0. 先确认没被踢到登录页 ──
  if (looksLikeLogin()) {
    return {
      ok: false,
      stage: 'needs_login',
      message: '打开编辑器时被重定向到登录页，请先在浏览器里登录该平台，再重新同步',
      url: location.href,
      finalUrl: location.href,
    }
  }

  // ── 1. 进入编辑器（小红书：写长文 → 新的创作）──
  for (const step of payload.entrySteps) {
    const clicked = await clickByTexts(step, { timeoutMs: 2500 })
    if (!clicked) {
      missing.push(`entry:${step[0]}`)
      continue
    }
    // 每次点完等一拍，SPA 可能要跳路由 / 拉组件
    await sleep(1200)
    if (looksLikeLogin()) {
      return {
        ok: false,
        stage: 'needs_login',
        message: '点击进入编辑器后被要求登录，请先登录该平台再重新同步',
        url: location.href,
        finalUrl: location.href,
      }
    }
  }

  // ── 2. 标题（轮询等待，重 SPA 经常要好几秒）──
  const titleEl = await waitFor<HTMLInputElement | HTMLTextAreaElement>(
    payload.titleSelectors,
    payload.waitMs
  )
  if (!titleEl) {
    if (looksLikeLogin()) {
      return { ok: false, stage: 'needs_login', message: '当前是登录页，请先登录该平台', url: location.href, finalUrl: location.href }
    }
    return {
      ok: false,
      stage: 'failed',
      message: `等待 ${payload.waitMs}ms 仍没找到标题输入框（可能被弹窗挡住或页面改版）`,
      url: location.href,
      missing: [...missing, 'title'],
      finalUrl: location.href,
    }
  }

  if (titleEl.isContentEditable) {
    setEditableText(titleEl, payload.title)
  } else {
    titleEl.focus()
    setNativeValue(titleEl, payload.title)
  }
  await sleep(200)

  // ── 3. 正文 ──
  const rawEditor = await waitFor<HTMLElement>(payload.editorSelectors, payload.waitMs)
  if (!rawEditor) {
    return {
      ok: false,
      stage: 'failed',
      message: '找到了标题框但没找到正文编辑器，页面结构可能已变化',
      url: location.href,
      missing: [...missing, 'editor'],
      finalUrl: location.href,
    }
  }

  // 老式后台（UEditor / KindEditor）把编辑器套在 iframe 里，
  // 真正可编辑的是 iframe 内文档的 body，直接改 iframe 元素没有意义。
  let editor = rawEditor
  if (rawEditor.tagName === 'IFRAME') {
    const innerBody = (rawEditor as unknown as HTMLIFrameElement).contentDocument?.body
    if (innerBody) editor = innerBody as unknown as HTMLElement
  }

  editor.focus()
  editor.click()
  await sleep(200)

  // 先全选再插入：复用标签页时不会把上一次的内容留在前面造成重复
  try {
    document.execCommand('selectAll')
  } catch {
    // 忽略：不支持就算了，后面还有兜底
  }

  // 优先走 execCommand（能被富文本编辑器正确接管），失败再退回 innerHTML
  let inserted = false
  try {
    inserted = document.execCommand('insertHTML', false, payload.html)
  } catch {
    inserted = false
  }

  if (!inserted || textLength(editor) < 10) {
    editor.innerHTML = payload.html
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload.html, inputType: 'insertText' }))
  }
  await sleep(800)

  if (textLength(editor) < 5) {
    return {
      ok: false,
      stage: 'failed',
      message: '正文写入失败，编辑器没有接受内容（可能是只读或需要先点一下编辑区）',
      url: location.href,
      missing: [...missing, 'editor-write'],
      finalUrl: location.href,
    }
  }

  // ── 4. 图片 ──
  let imageCount = 0
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]')
  if (fileInput && payload.images.length > 0) {
    imageCount = await uploadImages(fileInput, payload.images)
    await sleep(1500)
  }
  if (payload.requireImages && imageCount === 0) {
    return {
      ok: true,
      stage: 'filled',
      message: '该平台要求至少一张图片，正文已填入但图片未上传成功，请手动补充后发布',
      url: location.href,
      finalUrl: location.href,
    }
  }

  // ── 5. 草稿模式：点平台自己的「存草稿」 ──
  if (!payload.autoPublish) {
    if (payload.draftTexts.length > 0) {
      const clicked = await clickByTexts(payload.draftTexts, { allowDraft: true, timeoutMs: 4000 })
      if (clicked) {
        await sleep(2500)
        return {
          ok: true,
          stage: 'drafted',
          message: '已点击平台自己的「存草稿」，内容已进入草稿箱',
          url: location.href,
          finalUrl: location.href,
        }
      }
    }
    return {
      ok: true,
      stage: 'filled',
      message: '内容已填入编辑器（草稿模式，未点发布）',
      url: location.href,
      finalUrl: location.href,
    }
  }

  // ── 6. 发布前整理（小红书长文：一键排版 → 下一步）──
  for (const step of payload.prepareSteps) {
    const clicked = await clickByTexts(step, { timeoutMs: 4000 })
    if (!clicked) missing.push(`prepare:${step[0]}`)
    await sleep(1500)
  }

  // ── 7. 发布 ──
  const beforeUrl = location.href
  const publishBtn = findClickable(payload.publishTexts)
  if (!publishBtn) {
    return {
      ok: true,
      stage: 'filled',
      message: '内容已填入编辑器，但没找到发布按钮，请手动点发布',
      url: location.href,
      missing: [...missing, 'publish'],
      finalUrl: location.href,
    }
  }

  publishBtn.click()
  await sleep(4000)

  // 发布后可能出现二次确认弹窗（选择封面、确认发布等），再点一次
  const confirmTexts = payload.confirmTexts.length
    ? payload.confirmTexts
    : ['确认发布', '确定', '继续发布']
  const confirmBtn = findClickable(confirmTexts)
  if (confirmBtn && isUsable(confirmBtn)) {
    confirmBtn.click()
    await sleep(3000)
  }

  const successText = /发布成功|已发布|提交成功|审核中|发表成功/.test(document.body.innerText || '')
  const urlChanged = location.href !== beforeUrl

  if (successText || urlChanged) {
    return {
      ok: true,
      stage: 'published',
      message: '已点击发布并检测到成功反馈',
      url: location.href,
      finalUrl: location.href,
    }
  }

  return {
    ok: true,
    stage: 'submitted',
    message: '已点击发布，但页面未给出明确成功提示，请到平台确认',
    url: location.href,
    finalUrl: location.href,
  }
}

/**
 * 明确**不是**登录态凭证的 Cookie
 *
 * 这些 Cookie 游客也有（统计、反爬 WAF、云防护、UI 偏好），
 * 一旦被当成「会话 Cookie」，就会把没登录的用户显示成已登录，
 * 用户点同步才发现被踢到登录页 —— 比漏判更伤信任。
 */
const NON_SESSION_COOKIE = new RegExp(
  '^(?:' +
    [
      '_ga', '_gid', '_gat', '_gcl', '_fbp', '_clck', '_clsk', '_uetsid', '_uab_collina',
      'Hm_', 'HMACCOUNT', 'sensorsdata', 'sajssdk', 'cnzz', 'CNZZDATA', 'UM_distinctid',
      'bd_', '__utm', '__jsluid', '__jsl_clearance', 'acw_sc__v2', '__cf_bm', 'cf_clearance',
      '__51la', '_horizon', 'HORIZON', 'SERVERID', 'BIGipServer', 'wsc_', 'XSRF', 'csrf', '_csrf',
      's_v_web_id', 'msToken', 'ttwid', '__ac_nonce', '__ac_signature', 'ab_sr', 'ssxmod_itna',
      'noads_', 'statistic', 'monitor', '__root_domain_v', 'client_id', 'device_id', 'visitor_id',
      'accept_language', 'lang', 'locale', 'theme', 'resolution', 'timezone',
      // 通用「会话容器」ID：Java / .NET / PHP 建会话时游客就会拿到，
      // 只能证明「来过」，不能证明「登录了」。顺企网、八方资源网这类老后台尤其常见。
      'JSESSIONID', 'ASP.NET_SessionId', 'PHPSESSID',
    ].join('|') +
    ')',
  'i'
)

/** Cookie 名里出现这些词，几乎可以肯定与会话/身份有关 */
const SESSION_NAME_HINT = /session|token|auth|login|user|uid|member|account|vip|passport|ticket|credential/i

/** 一次 Cookie 查询的目标：URL（精确）或站点主域（需要应用层校验子域） */
interface CookieTarget {
  value: string
  isDomain: boolean
}

/**
 * 页面驱动发布适配器基类
 */
export abstract class PagePublishAdapter extends CodeAdapter {
  abstract readonly meta: PlatformMeta
  protected abstract readonly pageConfig: PagePublishConfig

  /** 登录态判断用的 cookie 名（子类覆盖） */
  protected abstract readonly sessionCookieNames: string[]

  /**
   * 是否需要登录态
   *
   * 投稿型平台（IT之家、InfoQ）本身就是公开表单，
   * 没登录也能打开，不应因为查不到 Cookie 就判成「未登录」。
   */
  protected readonly requiresAuth: boolean = true

  /** 预处理配置：页面编辑器都是富文本，统一要 HTML */
  readonly preprocessConfig = {
    outputFormat: 'html' as const,
    processLazyImages: true,
    removeSvgImages: true,
    removeIframes: true,
  }

  /**
   * 登录态检测：三级判定，从严到宽
   *
   * 1. 按平台已知的登录 Cookie 名精确命中（最可靠）
   * 2. 再按站点主域查一次（登录态常写在父域，如 `.jiemian.com`）
   * 3. 兜底：站点下存在 httpOnly 会话 Cookie（排除统计/反爬名单）
   *
   * 第 3 级是为了「真的登录了但 Cookie 名对不上」这类平台 —— 它们的登录
   * Cookie 名字随版本改（企鹅号的 p_uin / p_skey，顺企网的会员票据），
   * 靠白名单猜永远是滞后的。放宽到会话 Cookie 后，用户不会再被
   * 「明明登录了却显示未登录」卡住；万一真误判，发布会返回 needs_login 兜底。
   */
  async checkAuth(): Promise<AuthResult> {
    if (!this.requiresAuth) {
      // 公开投稿表单：可用，但不是「已登录」——authMode 让界面显示「无需登录」
      return { isAuthenticated: true, authMode: 'public' }
    }

    const editorUrl = this.pageConfig.editorUrl
    const loginUrl = this.pageConfig.loginUrl ?? editorUrl
    try {
      const targets = this.cookieTargets()

      if (await this.findNamedCookie(targets)) {
        return { isAuthenticated: true }
      }

      const inferred = await this.findSessionCookie(targets)
      if (inferred) {
        logger.debug(`[${this.meta.id}] 未命中已知 Cookie 名，按会话 Cookie 推断为已登录：${inferred}`)
        return { isAuthenticated: true }
      }

      return {
        isAuthenticated: false,
        error: `未检测到${this.meta.name}登录态，请先在浏览器打开 ${new URL(loginUrl).origin} 完成登录，再点「重新检测」`,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 要查 Cookie 的目标：编辑器地址、登录页地址，以及各自的站点主域
   *
   * 子域和父域的 Cookie 是分开存的，`chrome.cookies.getAll({ domain })`
   * 只认纯域名，所以主域单独作为一项传下去（运行时自己判断 URL / 域名）。
   */
  private cookieTargets(): CookieTarget[] {
    const raw = [this.pageConfig.editorUrl, this.pageConfig.loginUrl ?? this.pageConfig.editorUrl]
    const out: CookieTarget[] = []
    const seen = new Set<string>()
    for (const url of raw) {
      if (!seen.has(url)) {
        seen.add(url)
        out.push({ value: url, isDomain: false })
      }
      try {
        const parts = new URL(url).hostname.split('.')
        if (parts.length > 2) {
          const root = parts.slice(-2).join('.')
          if (!seen.has(root)) {
            seen.add(root)
            out.push({ value: root, isDomain: true })
          }
        }
      } catch {
        // 地址写错时忽略，交给下面的 Cookie 查询自然失败
      }
    }
    return out
  }

  /**
   * 按域名查回来的 Cookie 是否真的属于目标站点
   *
   * `chrome.cookies.getAll({ domain: 'qq.com' })` 会把**所有子域**的 Cookie 一起返回：
   * 查询 `qq.com` 能拿到 `mp.weixin.qq.com` 的 `ua_id`，于是企鹅号在没登录的机器上
   * 也会显示「已登录」。所以域名查询的结果必须在应用层再校验一次：只认该域本身
   * （`example.com` / `.example.com`），子域的 Cookie 是别的站点，一律不算。
   *
   * URL 查询不用校验 —— Chrome 只会返回「真的会发给这个地址」的 Cookie，父域是包含的。
   */
  private acceptsCookie(cookieDomain: string, target: CookieTarget): boolean {
    if (!target.isDomain) return true
    return cookieDomain.replace(/^\./, '') === target.value
  }

  /** 第 1、2 级：平台声明的登录 Cookie 名 */
  private async findNamedCookie(targets: CookieTarget[]): Promise<string | null> {
    for (const target of targets) {
      const cookies = await this.runtime.cookies.get(target.value)
      const hit = cookies.find(
        c => c.value && this.acceptsCookie(c.domain, target) && this.sessionCookieNames.includes(c.name)
      )
      if (hit) return hit.name
    }
    return null
  }

  /** 第 3 级：会话 Cookie 兜底（httpOnly 优先，其次名字带会话关键词） */
  private async findSessionCookie(targets: CookieTarget[]): Promise<string | null> {
    const now = Date.now() / 1000
    for (const target of targets) {
      const cookies = await this.runtime.cookies.get(target.value)
      const hit = cookies.find(c => {
        if (!c.value) return false
        if (!this.acceptsCookie(c.domain, target)) return false
        if (c.expirationDate && c.expirationDate < now) return false
        if (NON_SESSION_COOKIE.test(c.name)) return false
        return c.httpOnly || SESSION_NAME_HINT.test(c.name)
      })
      if (hit) return hit.name
    }
    return null
  }

  /**
   * 自检信息：让诊断面板知道这个平台靠哪个页面、哪些选择器工作
   */
  getDiagnostics(): AdapterDiagnostics {
    return {
      driver: 'page',
      requiresAuth: this.requiresAuth,
      authCookieNames: this.sessionCookieNames,
      entryUrl: this.pageConfig.editorUrl,
      loginUrl: this.pageConfig.loginUrl,
      entryUrlMatch: this.pageConfig.editorUrlMatch,
      mode: this.pageConfig.mode ?? 'editor',
      titleSelectors: this.pageConfig.titleSelectors,
      editorSelectors: this.pageConfig.editorSelectors,
      publishTexts: this.pageConfig.publishTexts,
      manualOnly: this.pageConfig.manualOnly,
      entrySteps: this.pageConfig.entrySteps,
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    const tabs = this.runtime.tabs
    if (!tabs) {
      return this.createResult(false, {
        error: '当前运行环境不支持页面发布（需要浏览器扩展环境）',
      })
    }

    const autoPublish = this.shouldPublish(options)
    const draftUrl = this.pageConfig.editorUrl
    const submissionMode = this.pageConfig.mode === 'submission'

    try {
      const tabId = await this.ensureEditorTab()

      // 纯人工平台：不注入内容，只把页面打开并说清楚要做什么
      if (this.pageConfig.manualOnly) {
        return this.createResult(true, {
          postUrl: draftUrl,
          draftOnly: true,
          reviewStatus: 'unknown',
          message: this.manualMessage(),
        })
      }

      const html = article.html || article.markdown || ''
      const images = this.extractImages(html, article.cover)

      logger.debug('Injecting content into tab', tabId, 'autoPublish:', autoPublish)

      const result = await tabs.executeScript(tabId, injectedPublish, [
        {
          title: article.title,
          html,
          images,
          titleSelectors: this.pageConfig.titleSelectors,
          editorSelectors: this.pageConfig.editorSelectors,
          publishTexts: this.pageConfig.publishTexts,
          draftTexts: this.pageConfig.draftTexts ?? [],
          confirmTexts: this.pageConfig.confirmTexts ?? [],
          entrySteps: this.pageConfig.entrySteps ?? [],
          prepareSteps: this.pageConfig.prepareSteps ?? [],
          requireImages: this.pageConfig.requireImages ?? false,
          autoPublish,
          waitMs: this.pageConfig.waitMs ?? 12000,
        },
      ])

      // 被踢到登录页：这不是「页面改版」，用户需要知道该去登录
      if (result?.stage === 'needs_login') {
        return this.createResult(false, {
          error: result.message || `需要先登录${this.meta.name}，再重新同步`,
          postUrl: result.finalUrl || draftUrl,
        })
      }

      if (!result || result.stage === 'failed') {
        // 投稿型平台没有统一表单，填不进去属于预期：降级为「已打开投稿页」
        if (submissionMode) {
          return this.createResult(true, {
            postUrl: draftUrl,
            draftOnly: true,
            reviewStatus: 'unknown',
            message: `已打开${this.meta.name}投稿页。该平台只接受投稿、没有自助发布入口，请粘贴正文后手动提交`,
          })
        }
        return this.createResult(false, {
          error: result?.message || '页面发布失败',
          postUrl: draftUrl,
        })
      }

      // 投稿型平台无论是否填入，最终都要人工提交
      if (submissionMode) {
        return this.createResult(true, {
          postUrl: result.url || draftUrl,
          draftOnly: true,
          reviewStatus: 'unknown',
          message:
            result.stage === 'filled'
              ? `内容已填入${this.meta.name}投稿表单，请补全联系方式后手动提交`
              : result.message || '已填入投稿表单，请手动提交',
        })
      }

      const published = result.stage === 'published'
      const message =
        result.message ||
        (published
          ? '已发布'
          : result.stage === 'drafted'
            ? '内容已存入平台草稿箱'
            : '内容已填入编辑器，请到平台确认或手动发布')
      return this.createResult(true, {
        postUrl: result.url || draftUrl,
        draftOnly: !published,
        reviewStatus: published ? 'reviewing' : 'unknown',
        reviewStatusText: message,
        message,
      })
    } catch (error) {
      logger.error('Page publish failed:', error)
      return this.createResult(false, {
        error: `页面发布失败：${(error as Error).message}`,
        postUrl: draftUrl,
      })
    }
  }

  /** 纯人工平台的提示文案（子类可覆盖） */
  protected manualMessage(): string {
    return `已打开${this.meta.name}入口页。该平台没有文章编辑器，需要人工填写后提交`
  }

  /**
   * 找到（或打开）编辑器 tab
   *
   * 复用已经打开的编辑器标签页，避免每次同步都堆一个新标签页。
   * 复用时旧内容不会被保留 —— 注入脚本会先全选再插入，相当于整篇覆盖。
   */
  private async ensureEditorTab(): Promise<number> {
    const tabs = this.runtime.tabs!
    const pattern = `${new URL(this.pageConfig.editorUrl).origin}/*`

    const existing = await tabs.query(pattern)
    const editorTab = existing.find(tab => (tab.url || '').includes(this.pageConfig.editorUrlMatch))

    if (editorTab) {
      logger.debug('Reusing editor tab', editorTab.id)
      return editorTab.id
    }

    const created = await tabs.create(this.pageConfig.editorUrl, false)
    await tabs.waitForLoad(created.id)
    // 编辑器是 SPA，等它把表单渲染出来；重编辑器额外多等一会儿
    await this.delay(2000 + (this.pageConfig.extraWaitMs ?? 0))
    return created.id
  }

  /**
   * 从正文里抽取图片地址，封面优先
   */
  private extractImages(html: string, cover?: string): string[] {
    const urls: string[] = []
    if (cover) urls.push(cover)

    const regex = /<img[^>]+src=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      const src = match[1]
      if (!src || src.startsWith('data:') || urls.includes(src)) continue
      urls.push(src)
    }
    return urls.slice(0, 9)
  }
}

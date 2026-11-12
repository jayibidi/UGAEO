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
 * - filled：内容已填好但没找到发布按钮 → 当作草稿，返回编辑器地址让用户手动发
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
  /** 标题输入框候选选择器 */
  titleSelectors: string[]
  /** 正文编辑器候选选择器 */
  editorSelectors: string[]
  /** 发布按钮文案（按顺序匹配） */
  publishTexts: string[]
  /** 是否必须有图片（小红书这类图文平台） */
  requireImages?: boolean
  /**
   * 发布形态
   * - editor（默认）：创作者后台的富文本编辑器，能填就能点发布
   * - submission：只有投稿 / 爆料表单，没有发布按钮；填不进去时降级为
   *   「打开投稿页 + 提示手动提交」，而不是报失败
   */
  mode?: 'editor' | 'submission'
  /** 编辑器是重 SPA 时，注入前额外等待的时间（毫秒） */
  extraWaitMs?: number
}

export interface InjectedPublishPayload {
  title: string
  html: string
  images: string[]
  titleSelectors: string[]
  editorSelectors: string[]
  publishTexts: string[]
  requireImages: boolean
  autoPublish: boolean
}

export type InjectedStage = 'published' | 'submitted' | 'filled' | 'failed'

export interface InjectedPublishResult {
  ok: boolean
  stage: InjectedStage
  message?: string
  url?: string
}

/**
 * 在页面上下文中执行的填充 / 发布脚本
 *
 * 注意：这个函数会被 chrome.scripting.executeScript 序列化后在页面里执行，
 * 因此函数体内不能引用任何外部变量或 import。
 */
export async function injectedPublish(payload: InjectedPublishPayload): Promise<InjectedPublishResult> {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const queryFirst = <T extends Element>(selectors: string[]): T | null => {
    for (const selector of selectors) {
      const el = document.querySelector<T>(selector)
      if (el) return el
    }
    return null
  }

  const isUsable = (el: HTMLElement | null): boolean => {
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
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

  /**
   * 按文案找可点击元素
   *
   * 先精确匹配，再退回「包含匹配」：不少平台的按钮是「发布文章」「立即发布」
   * 这类带修饰的词，只做全等会一个都命中不了。但包含匹配要排除
   * 「存草稿 / 定时 / 预览 / 取消」这类会把内容带去别处的按钮。
   */
  const findButton = (texts: string[]): HTMLElement | null => {
    const normalize = (value: string | null) => (value || '').replace(/\s+/g, '')
    const BLOCK_WORDS = ['取消', '删除', '设置', '预览', '定时', '草稿']

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    ).filter(node => {
      if (node.getAttribute('aria-disabled') === 'true') return false
      if ((node as HTMLButtonElement).disabled) return false
      return isUsable(node)
    })

    for (const text of texts) {
      const target = normalize(text)
      if (!target) continue
      const exact = nodes.find(node => normalize(node.textContent) === target)
      if (exact) return exact.closest('button, [role="button"], a') || exact
    }

    for (const text of texts) {
      const target = normalize(text)
      if (!target) continue
      const loose = nodes.find(node => {
        const own = normalize(node.textContent)
        if (!own.includes(target)) return false
        // 只接受「比目标文案长一点」的按钮，避免匹配到整块容器
        if (own.length > target.length + 4) return false
        if (BLOCK_WORDS.some(word => own.includes(word))) return false
        return true
      })
      if (loose) return loose.closest('button, [role="button"], a') || loose
    }

    return null
  }

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

  // ── 1. 标题 ──
  const titleEl = queryFirst<HTMLInputElement | HTMLTextAreaElement>(payload.titleSelectors)
  if (!titleEl || !isUsable(titleEl)) {
    return { ok: false, stage: 'failed', message: '未找到标题输入框，页面结构可能已变化' }
  }
  titleEl.focus()
  setNativeValue(titleEl, payload.title)
  await sleep(150)

  // ── 2. 正文 ──
  const rawEditor = queryFirst<HTMLElement>(payload.editorSelectors)
  if (!rawEditor) {
    return { ok: false, stage: 'failed', message: '未找到正文编辑器，页面结构可能已变化' }
  }

  // 老式后台（UEditor / KindEditor）把编辑器套在 iframe 里，
  // 真正可编辑的是 iframe 内文档的 body，直接改 iframe 元素没有意义。
  let editor = rawEditor
  if (rawEditor.tagName === 'IFRAME') {
    const innerBody = (rawEditor as HTMLIFrameElement).contentDocument?.body
    if (innerBody) editor = innerBody as HTMLElement
  }

  if (!isUsable(editor)) {
    return { ok: false, stage: 'failed', message: '未找到正文编辑器，页面结构可能已变化' }
  }

  editor.focus()
  editor.click()
  await sleep(150)

  // 优先走 execCommand（能被富文本编辑器正确接管），失败再退回 innerHTML
  let inserted = false
  try {
    inserted = document.execCommand('insertHTML', false, payload.html)
  } catch {
    inserted = false
  }

  const textLength = (el: HTMLElement) => (el.innerText || '').replace(/\s+/g, '').length
  if (!inserted || textLength(editor) < 10) {
    editor.innerHTML = payload.html
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload.html, inputType: 'insertText' }))
  }
  await sleep(600)

  if (textLength(editor) < 5) {
    return { ok: false, stage: 'failed', message: '正文写入失败，编辑器未接受内容' }
  }

  // ── 3. 图片 ──
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
    }
  }

  if (!payload.autoPublish) {
    return { ok: true, stage: 'filled', message: '已填入编辑器（草稿模式，未点击发布）', url: location.href }
  }

  // ── 4. 发布 ──
  const beforeUrl = location.href
  const publishBtn = findButton(payload.publishTexts)
  if (!publishBtn) {
    return {
      ok: true,
      stage: 'filled',
      message: '内容已填入编辑器，但未找到发布按钮，请手动点击发布',
      url: location.href,
    }
  }

  publishBtn.click()
  await sleep(4000)

  // 发布后可能出现二次确认弹窗（选择封面、确认发布等），再点一次
  const confirmBtn = findButton(['确定', '确认发布', '继续发布'])
  if (confirmBtn && isUsable(confirmBtn)) {
    confirmBtn.click()
    await sleep(3000)
  }

  const successText = /发布成功|已发布|提交成功|审核中/.test(document.body.innerText || '')
  const urlChanged = location.href !== beforeUrl

  if (successText || urlChanged) {
    return {
      ok: true,
      stage: 'published',
      message: '已点击发布并检测到成功反馈',
      url: location.href,
    }
  }

  return {
    ok: true,
    stage: 'submitted',
    message: '已点击发布，但页面未给出明确成功提示，请到平台确认',
    url: location.href,
  }
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
   * 投稿型平台（IT之家、InfoQ、快懂百科）本身就是公开表单，
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
   * 登录态检测：按「会发送到创作者后台的 Cookie」判断
   *
   * 必须用 origin/URL 去查，而不是域名。登录 Cookie（如头条的 `sessionid`）
   * 通常写在父域 `.toutiao.com` 上，按子域 `mp.toutiao.com` 查 domain 会漏掉，
   * 表现为「明明登录了，扩展一直显示未登录」。
   */
  async checkAuth(): Promise<AuthResult> {
    if (!this.requiresAuth) {
      // 公开投稿表单：可用，但不是「已登录」——authMode 让界面显示「无需登录」
      return { isAuthenticated: true, authMode: 'public' }
    }

    const editorUrl = this.pageConfig.editorUrl
    try {
      const cookies = await this.runtime.cookies.get(editorUrl)
      const hit = cookies.find(c => this.sessionCookieNames.includes(c.name) && c.value)
      if (hit) {
        return { isAuthenticated: true, username: undefined }
      }

      // 兜底：再按站点主域查一次（个别平台把登录态写在兄弟子域上）
      const host = new URL(editorUrl).hostname
      const parts = host.split('.')
      if (parts.length > 2) {
        const rootDomain = parts.slice(-2).join('.')
        const rootCookies = await this.runtime.cookies.get(rootDomain)
        const rootHit = rootCookies.find(
          c => this.sessionCookieNames.includes(c.name) && c.value
        )
        if (rootHit) {
          return { isAuthenticated: true, username: undefined }
        }
      }

      return {
        isAuthenticated: false,
        error: `未检测到${this.meta.name}登录态，请先在浏览器打开 ${new URL(editorUrl).origin} 完成登录，再点「重新检测」`,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
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
      entryUrlMatch: this.pageConfig.editorUrlMatch,
      mode: this.pageConfig.mode ?? 'editor',
      titleSelectors: this.pageConfig.titleSelectors,
      editorSelectors: this.pageConfig.editorSelectors,
      publishTexts: this.pageConfig.publishTexts,
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
          requireImages: this.pageConfig.requireImages ?? false,
          autoPublish,
        },
      ])

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
      return this.createResult(true, {
        postUrl: result.url || draftUrl,
        draftOnly: !published,
        reviewStatus: published ? 'reviewing' : 'unknown',
        reviewStatusText: result.message,
        message: result.message,
      })
    } catch (error) {
      logger.error('Page publish failed:', error)
      return this.createResult(false, {
        error: `页面发布失败：${(error as Error).message}`,
        postUrl: draftUrl,
      })
    }
  }

  /**
   * 找到（或打开）编辑器 tab
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
    await this.delay(2500 + (this.pageConfig.extraWaitMs ?? 0))
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

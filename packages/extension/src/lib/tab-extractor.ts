/**
 * 跨标签页提取文章（带自愈）
 *
 * popup / 控制台都要向当前标签页的 content script 要文章。
 * 直接 `chrome.tabs.sendMessage` 在下面这些情况必然 reject
 * （报 `Could not establish connection. Receiving end does not exist.`）：
 *
 *  1. 页面根本不允许注入：chrome:// / edge:// / 扩展页 / 应用商店 / PDF 阅读器…
 *  2. 页面在扩展安装或重新加载之前就打开了 —— 这一条最常见，
 *     此时 content script 并不存在，刷新一下页面就好，但用户不知道。
 *
 * 这里把两种情况区分开：
 *  - 不可注入 → 直接返回 `unsupported-page`，不打错误日志，由 UI 给出提示；
 *  - 可注入但不在 → 用 `chrome.scripting` 补注入 extractor 后重试几次。
 *
 * 绝不向调用方抛异常：调用方拿到 `{ article, reason }` 自己决定怎么展示。
 */
import { createLogger } from './logger'
import { sendTabMessage } from './messaging'

const logger = createLogger('TabExtractor')

export type ExtractFailureReason =
  /** 当前是浏览器内部页面 / 应用商店等，扩展无权注入 */
  | 'unsupported-page'
  /** 补注入后仍然没有接收端，通常是页面正在跳转 */
  | 'no-content-script'
  /** 有接收端，但页面里没提取到正文 */
  | 'empty'
  /** 拿不到标签页 */
  | 'no-tab'

export interface ExtractOutcome<T = unknown> {
  article: T | null
  reason?: ExtractFailureReason
}

/** 这些前缀的页面禁止注入 content script */
const BLOCKED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-untrusted://',
  'chrome-search://',
  'devtools://',
  'edge://',
  'about:',
  'view-source:',
  'moz-extension://',
  'file://',
]

/** 能打开但注入被浏览器拦下的页面 */
const BLOCKED_HOSTS = [
  'chrome.google.com', // 旧版应用商店
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com', // Edge 加载项
]

/** 判断这个 URL 是否允许注入 content script */
export function isInjectableUrl(url?: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  if (BLOCKED_PREFIXES.some(prefix => lower.startsWith(prefix))) return false
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false

  try {
    const { hostname, pathname } = new URL(url)
    if (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) return false
    if (BLOCKED_HOSTS.includes(hostname)) return false
  } catch {
    return false
  }

  return true
}

/**
 * 从 manifest 里找 extractor 的入口文件。
 * 开发态是 `src/content/extractor.ts`，构建后是 `assets/extractor.ts-<hash>-loader.js`，
 * 所以不能写死路径，只能反查 manifest。
 */
function findExtractorScript(): string | null {
  try {
    const manifest = chrome.runtime.getManifest()
    const files = (manifest.content_scripts || []).flatMap(entry => entry.js || [])
    return files.find(file => /extractor/i.test(file)) || null
  } catch {
    return null
  }
}

async function injectExtractor(tabId: number): Promise<boolean> {
  const script = findExtractorScript()
  if (!script) return false

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [script] })
    return true
  } catch (error) {
    // 应用商店页、被策略拦截的页面会走这里，属预期情况
    logger.debug('inject extractor failed:', (error as Error).message)
    return false
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 注入后 content script 需要一小段时间注册监听器，分几档重试 */
const RETRY_DELAYS = [80, 120, 200, 320]

/**
 * 向指定标签页请求提取文章，失败时自动补注入 content script。
 */
export async function extractArticleFromTab<T = unknown>(
  tabId: number,
  tabUrl?: string
): Promise<ExtractOutcome<T>> {
  if (!isInjectableUrl(tabUrl)) {
    logger.debug('skip extraction on non-injectable page:', tabUrl)
    return { article: null, reason: 'unsupported-page' }
  }

  // 1) content script 已在页面里（绝大多数情况）
  const first = await sendTabMessage<{ article?: T | null }>(tabId, { type: 'EXTRACT_ARTICLE' })
  if (first) {
    const article = first.article ?? null
    return article ? { article } : { article: null, reason: 'empty' }
  }

  // 2) 页面早于扩展加载 → 补注入后重试
  logger.debug('no receiver in tab, injecting extractor:', tabId)
  const injected = await injectExtractor(tabId)
  if (!injected) return { article: null, reason: 'unsupported-page' }

  for (const delay of RETRY_DELAYS) {
    await wait(delay)
    const response = await sendTabMessage<{ article?: T | null }>(tabId, { type: 'EXTRACT_ARTICLE' })
    if (response) {
      const article = response.article ?? null
      return article ? { article } : { article: null, reason: 'empty' }
    }
  }

  logger.debug('extractor injected but still unreachable:', tabId)
  return { article: null, reason: 'no-content-script' }
}

/** 给 UI 用的失败文案 */
export function describeExtractFailure(reason?: ExtractFailureReason): string {
  switch (reason) {
    case 'unsupported-page':
      return '当前页面不支持提取（浏览器内部页、扩展商店等），请打开要同步的文章页'
    case 'no-content-script':
      return '页面还在加载或刚刚刷新过，请稍等片刻再重新打开本面板'
    case 'empty':
      return '这个页面没有识别到文章正文，请确认打开的是文章详情页'
    case 'no-tab':
      return '没有可用的标签页'
    default:
      return '未能提取到文章，请在文章页面重试'
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeExtractFailure,
  extractArticleFromTab,
  isInjectableUrl,
} from '../src/lib/tab-extractor'

describe('isInjectableUrl', () => {
  it('普通网页可注入', () => {
    expect(isInjectableUrl('https://mp.weixin.qq.com/s/abc')).toBe(true)
    expect(isInjectableUrl('http://localhost:5173/post/1')).toBe(true)
  })

  it('浏览器内部页不可注入', () => {
    expect(isInjectableUrl('chrome://extensions')).toBe(false)
    expect(isInjectableUrl('chrome-extension://abc/popup.html')).toBe(false)
    expect(isInjectableUrl('edge://settings')).toBe(false)
    expect(isInjectableUrl('about:blank')).toBe(false)
    expect(isInjectableUrl('devtools://devtools/bundled/inspector.html')).toBe(false)
  })

  it('应用商店页面不可注入', () => {
    expect(isInjectableUrl('https://chromewebstore.google.com/detail/xxx')).toBe(false)
    expect(isInjectableUrl('https://chrome.google.com/webstore/detail/xxx')).toBe(false)
    expect(isInjectableUrl('https://microsoftedge.microsoft.com/addons/detail/xxx')).toBe(false)
  })

  it('缺少 URL 或非法 URL 视为不可注入', () => {
    expect(isInjectableUrl(undefined)).toBe(false)
    expect(isInjectableUrl('')).toBe(false)
    expect(isInjectableUrl('not a url')).toBe(false)
  })
})

describe('describeExtractFailure', () => {
  it('每种失败原因都有可读文案', () => {
    expect(describeExtractFailure('unsupported-page')).toContain('不支持')
    expect(describeExtractFailure('no-content-script')).toContain('刷新')
    expect(describeExtractFailure('empty')).toContain('正文')
    expect(describeExtractFailure('no-tab')).toContain('标签页')
    expect(describeExtractFailure(undefined)).toContain('重试')
  })
})

/** 模拟 chrome 的三块接口：tabs.sendMessage / scripting.executeScript / runtime.getManifest */
function stubChrome(options: {
  sendMessage: () => Promise<unknown>
  executeScript?: () => Promise<unknown>
}) {
  const sendMessage = vi.fn(options.sendMessage)
  const executeScript = vi.fn(options.executeScript ?? (async () => []))
  const chrome = {
    tabs: { sendMessage },
    scripting: { executeScript },
    runtime: {
      getManifest: () => ({
        content_scripts: [
          { js: ['reader.js'] },
          { js: ['assets/extractor.ts-abc123-loader.js'] },
        ],
      }),
    },
  }
  vi.stubGlobal('chrome', chrome)
  return { sendMessage, executeScript }
}

const receiversMissing = () =>
  Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))

describe('extractArticleFromTab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('不可注入的页面直接返回 unsupported-page，且不发消息', async () => {
    const { sendMessage } = stubChrome({ sendMessage: receiversMissing })

    const result = await extractArticleFromTab(1, 'chrome://extensions')

    expect(result).toEqual({ article: null, reason: 'unsupported-page' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('content script 在时直接返回文章，不触发补注入', async () => {
    const { executeScript } = stubChrome({
      sendMessage: async () => ({ article: { title: '标题' } }),
    })

    const result = await extractArticleFromTab(1, 'https://juejin.cn/post/1')

    expect(result.article).toEqual({ title: '标题' })
    expect(executeScript).not.toHaveBeenCalled()
  })

  it('接收端不存在时补注入后重试成功（扩展重载后的旧标签页）', async () => {
    let calls = 0
    const { executeScript } = stubChrome({
      sendMessage: async () => {
        calls++
        // 第一次没有接收端，注入之后才可达
        if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.')
        return { article: { title: '补注入后提取' } }
      },
    })

    const promise = extractArticleFromTab(1, 'https://juejin.cn/post/1')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.article).toEqual({ title: '补注入后提取' })
    expect(executeScript).toHaveBeenCalledTimes(1)
    // 注入的是 manifest 里带 extractor 的那个入口，而不是写死的路径
    expect(executeScript.mock.calls[0][0]).toMatchObject({
      target: { tabId: 1 },
      files: ['assets/extractor.ts-abc123-loader.js'],
    })
  })

  it('补注入后仍不可达返回 no-content-script（UI 提示刷新页面）', async () => {
    const { sendMessage } = stubChrome({ sendMessage: receiversMissing })

    const promise = extractArticleFromTab(1, 'https://juejin.cn/post/1')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ article: null, reason: 'no-content-script' })
    // 首次尝试 + 4 次重试
    expect(sendMessage).toHaveBeenCalledTimes(5)
  })

  it('有接收端但页面没正文时返回 empty', async () => {
    stubChrome({ sendMessage: async () => ({ article: null }) })

    const result = await extractArticleFromTab(1, 'https://juejin.cn/post/1')

    expect(result).toEqual({ article: null, reason: 'empty' })
  })

  it('补注入被浏览器拦下（商店/策略页）时和不可注入同样处理', async () => {
    stubChrome({
      sendMessage: receiversMissing,
      executeScript: async () => {
        throw new Error('Cannot access contents of the page')
      },
    })

    const promise = extractArticleFromTab(1, 'https://example.com/post')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ article: null, reason: 'unsupported-page' })
  })
})

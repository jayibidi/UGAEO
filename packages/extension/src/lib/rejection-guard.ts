/**
 * 未捕获 Promise 拒绝的统一处理
 *
 * MV3 里任何未 catch 的 Promise 拒绝都会出现在 chrome://extensions 的「错误」面板中。
 * 扩展里有大量 fire-and-forget 的 sendMessage 调用，下面这些是**预期内**的：
 *
 *   - Could not establish connection. Receiving end does not exist.
 *     目标标签页没有 content script（chrome:// 页面、新标签页、PDF 阅读器、刚打开还没注入）
 *   - The message port closed before a response was received.
 *     页面在响应前被关闭或发生导航
 *   - A listener indicated an asynchronous response by returning true,
 *     but the message channel closed before a response was received.
 *     同上，长耗时处理过程中用户关掉了页面
 *   - No tab with id / The tab was closed.
 *
 * 这些既不是功能故障，也不该淹没真正的错误，所以降级为 warn（控制台仍可见）；
 * 其他异常不拦截，照常上报，方便排查。
 */

/** 已知的、无需上报的噪声匹配规则 */
const BENIGN_PATTERNS: RegExp[] = [
  /Receiving end does not exist/i,
  /message (?:port|channel) closed before a response was received/i,
  /No tab with id/i,
  /The tab was closed/i,
  /Frame with ID .* was removed/i,
  // 扩展被重新加载/更新后，旧页面里的上下文失效
  /Extension context invalidated/i,
]

export function isBenignRejection(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : ''
  if (!message) return false
  return BENIGN_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * 安装拦截器。每个运行上下文（service worker / popup / 控制台 / 编辑器）调用一次即可，
 * 重复调用不会重复挂监听。
 */
export function installRejectionGuard(scope: string): void {
  const flag = globalThis as typeof globalThis & { __ugaeoRejectionGuard?: boolean }
  if (flag.__ugaeoRejectionGuard) return
  flag.__ugaeoRejectionGuard = true

  globalThis.addEventListener('unhandledrejection', event => {
    if (!isBenignRejection(event.reason)) return // 真错误：保持默认上报
    event.preventDefault()
    const detail = event.reason instanceof Error ? event.reason.message : String(event.reason)
    console.warn(`[${scope}] 已忽略预期内的消息传递失败：${detail}`)
  })
}

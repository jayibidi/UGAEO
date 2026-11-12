/**
 * 标签页消息发送封装
 *
 * `chrome.tabs.sendMessage` 返回 Promise：当目标标签页没有注入 content script
 * （chrome:// 页面、新标签页、PDF 阅读器、页面还没加载完）时会 reject。
 * 直接 fire-and-forget 会产生未捕获的 Promise 拒绝，最终出现在扩展「错误」面板里。
 *
 * 这里统一吞掉失败并返回 null，调用方按需判断。
 */
export async function sendTabMessage<T = unknown>(
  tabId: number,
  message: unknown
): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch {
    // 接收端不存在属于预期情况，无需上报
    return null
  }
}

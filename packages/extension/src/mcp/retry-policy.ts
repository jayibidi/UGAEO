/**
 * MCP 重连策略（纯逻辑，便于单测）
 *
 * 为什么单独抽出来：客户端本体 import 了 adapters / sync-service，在 Node 测试环境
 * 里跑不起来；而「什么时候该停手」这条规则又必须被钉死 —— 没跑本地 MCP 服务的
 * 普通用户，每失败一次 Chrome 就往扩展错误面板记一条，会以为扩展坏了。
 */

export interface RetryState {
  /** 上次成功连接的时间戳，0 表示这一次会话里从没连上过 */
  lastConnectedAt: number
  /** 从没连上过时的累计失败次数 */
  coldFailures: number
  /** 允许的最大失败次数 */
  maxColdFailures: number
}

/**
 * 是否应该彻底停止重连
 *
 * 只有「从没连上过」才计数：连上过又断了说明服务真的在，值得一直重试。
 */
export function shouldStopRetrying(state: RetryState): boolean {
  return state.lastConnectedAt === 0 && state.coldFailures >= state.maxColdFailures
}

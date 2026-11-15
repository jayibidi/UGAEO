/**
 * MCP 重连策略
 *
 * 锁死两件事：
 * 1. 从没连上过 → 失败到上限就停手（否则每次失败都在扩展错误面板留一条）；
 * 2. 连上过又断了 → 一直重试（服务是真的在，只是重启）。
 */
import { describe, expect, it } from 'vitest'
import { shouldStopRetrying } from '../src/mcp/retry-policy'

describe('MCP 重连策略', () => {
  it('从未连上过：到上限就停止，没到上限继续', () => {
    expect(shouldStopRetrying({ lastConnectedAt: 0, coldFailures: 0, maxColdFailures: 2 })).toBe(false)
    expect(shouldStopRetrying({ lastConnectedAt: 0, coldFailures: 1, maxColdFailures: 2 })).toBe(false)
    expect(shouldStopRetrying({ lastConnectedAt: 0, coldFailures: 2, maxColdFailures: 2 })).toBe(true)
  })

  it('连上过：无论失败多少次都继续重试', () => {
    expect(shouldStopRetrying({ lastConnectedAt: Date.now(), coldFailures: 99, maxColdFailures: 2 })).toBe(false)
  })
})

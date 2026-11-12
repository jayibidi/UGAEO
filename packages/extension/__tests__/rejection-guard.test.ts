import { describe, expect, it } from 'vitest'
import { isBenignRejection } from '../src/lib/rejection-guard'

describe('isBenignRejection', () => {
  it('把「接收端不存在」判为可忽略', () => {
    expect(
      isBenignRejection(
        new Error('Could not establish connection. Receiving end does not exist.')
      )
    ).toBe(true)
  })

  it('把「消息端口提前关闭」判为可忽略', () => {
    expect(
      isBenignRejection(
        new Error('The message port closed before a response was received.')
      )
    ).toBe(true)
  })

  it('把「标签页已关闭」判为可忽略', () => {
    expect(isBenignRejection(new Error('No tab with id: 12345.'))).toBe(true)
    expect(isBenignRejection('The tab was closed.')).toBe(true)
  })

  it('把扩展上下文失效判为可忽略', () => {
    expect(isBenignRejection(new Error('Extension context invalidated.'))).toBe(true)
  })

  it('真实错误不吞，保持上报', () => {
    expect(isBenignRejection(new Error('TypeError: Cannot read properties of undefined'))).toBe(false)
    expect(isBenignRejection(new Error('HTTP 401 Unauthorized'))).toBe(false)
  })

  it('空值/非字符串不误判', () => {
    expect(isBenignRejection(undefined)).toBe(false)
    expect(isBenignRejection(null)).toBe(false)
    expect(isBenignRejection({ code: 1 })).toBe(false)
  })
})

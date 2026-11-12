import { describe, expect, it } from 'vitest'
import { mapZhihuReviewState } from '../platforms/zhihu'
import { mapJuejinVerifyStatus } from '../platforms/juejin'

describe('知乎审核状态映射', () => {
  it('已发布相关状态都归一为 published', () => {
    expect(mapZhihuReviewState('published')).toBe('published')
    expect(mapZhihuReviewState('passed')).toBe('published')
    expect(mapZhihuReviewState('approved')).toBe('published')
  })

  it('审核中相关状态都归一为 reviewing', () => {
    for (const state of ['reviewing', 'auditing', 'pending', 'checking', 'submitted']) {
      expect(mapZhihuReviewState(state)).toBe('reviewing')
    }
  })

  it('驳回相关状态都归一为 rejected', () => {
    for (const state of ['rejected', 'failed', 'violation', 'blocked']) {
      expect(mapZhihuReviewState(state)).toBe('rejected')
    }
  })

  it('未知状态不猜测，返回 unknown', () => {
    expect(mapZhihuReviewState('')).toBe('unknown')
    expect(mapZhihuReviewState('draft')).toBe('unknown')
    expect(mapZhihuReviewState('something-new')).toBe('unknown')
  })
})

describe('掘金审核状态映射', () => {
  it('按 verify_status 判定', () => {
    expect(mapJuejinVerifyStatus(1)).toBe('published')
    expect(mapJuejinVerifyStatus(2)).toBe('reviewing')
    expect(mapJuejinVerifyStatus(3)).toBe('rejected')
    expect(mapJuejinVerifyStatus(0)).toBe('reviewing')
  })

  it('verify_status 缺失时用 status 兜底', () => {
    expect(mapJuejinVerifyStatus(undefined, 1)).toBe('published')
    expect(mapJuejinVerifyStatus(undefined, 2)).toBe('unknown')
  })

  it('两个字段都没有时返回 unknown', () => {
    expect(mapJuejinVerifyStatus()).toBe('unknown')
  })
})

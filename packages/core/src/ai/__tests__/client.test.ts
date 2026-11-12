import { describe, expect, it } from 'vitest'
import { extractJSON, normalizeBaseUrl, DEFAULT_AI_BASE_URL } from '../client'

describe('normalizeBaseUrl', () => {
  it('默认使用中转站地址', () => {
    expect(normalizeBaseUrl()).toBe(DEFAULT_AI_BASE_URL)
    expect(normalizeBaseUrl('')).toBe(DEFAULT_AI_BASE_URL)
  })

  it('保留已有的 /v1 并去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.ugooto-ai.com/v1/')).toBe('https://api.ugooto-ai.com/v1')
  })

  it('缺少版本段时自动补 /v1', () => {
    expect(normalizeBaseUrl('https://api.ugooto-ai.com')).toBe('https://api.ugooto-ai.com/v1')
    expect(normalizeBaseUrl('https://api.ugooto-ai.com/api')).toBe('https://api.ugooto-ai.com/api/v1')
  })

  it('用户粘贴完整 completions 地址时回退到根路径', () => {
    expect(normalizeBaseUrl('https://api.ugooto-ai.com/v1/chat/completions')).toBe(
      'https://api.ugooto-ai.com/v1'
    )
  })

  it('支持其他版本号', () => {
    expect(normalizeBaseUrl('https://x.com/v2')).toBe('https://x.com/v2')
  })
})

describe('extractJSON', () => {
  it('解析纯 JSON', () => {
    expect(extractJSON<{ titles: string[] }>('{"titles":["a"]}')).toEqual({ titles: ['a'] })
  })

  it('解析代码块包裹的 JSON', () => {
    expect(extractJSON<{ tags: string[] }>('```json\n{"tags":["x","y"]}\n```')).toEqual({
      tags: ['x', 'y'],
    })
  })

  it('解析前后带解释文字的 JSON', () => {
    expect(extractJSON<{ summary: string }>('结果如下：\n{"summary":"ok"}\n以上')).toEqual({
      summary: 'ok',
    })
  })

  it('无法解析时返回 null', () => {
    expect(extractJSON('完全不是 JSON')).toBeNull()
  })
})

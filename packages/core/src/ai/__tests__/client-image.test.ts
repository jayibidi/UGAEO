/**
 * AI 生图客户端
 *
 * 中转站对 /images/generations 的支持参差不齐，这里锁死三条：
 * 1. 先要 b64_json，网关不认这个字段时去掉重试一次（不能直接失败）；
 * 2. b64 与 url 两种返回都要能拿到图；
 * 3. 没拿到图必须抛中文错误，让界面能提示「换个模型」而不是静默什么都不发生。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError, OpenAICompatibleClient } from '../client'

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function client() {
  return new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'doubao-seedream-4-0-250828',
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateImage', () => {
  it('b64_json 返回转成 dataURL，并按文件头猜 mime', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: PNG_B64 }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await client().generateImage('扁平插画风格的封面图')

    expect(result.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
    expect(result.url).toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/images/generations')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('doubao-seedream-4-0-250828')
    expect(body.prompt).toBe('扁平插画风格的封面图')
    expect(body.response_format).toBe('b64_json')
  })

  it('只给 url 时把 url 交回调用方', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] }))
    )

    const result = await client().generateImage('星空')
    expect(result.url).toBe('https://cdn.example.com/a.png')
    expect(result.dataUrl).toBeUndefined()
  })

  it('网关不认 response_format 时去掉该字段重试一次', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if ('response_format' in body) {
        return jsonResponse({ error: { message: 'unknown field response_format' } }, 400)
      }
      return jsonResponse({ data: [{ b64_json: PNG_B64 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await client().generateImage('一只猫')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.dataUrl).toBeTruthy()
  })

  it('其它 400（如尺寸不支持）不重试，直接报原文', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'size 4096x4096 is not supported' } }, 400)
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().generateImage('一只猫', { size: '4096x4096' })).rejects.toThrow(
      /size 4096x4096 is not supported/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('接口没给图时报可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))

    await expect(client().generateImage('一只猫')).rejects.toBeInstanceOf(AIError)
    await expect(client().generateImage('一只猫')).rejects.toThrow(/没有返回图片/)
  })

  it('空提示词直接拒绝，不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().generateImage('   ')).rejects.toThrow(/描述/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('listModels 带回能力声明', () => {
  it('解析 supported_endpoint_types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'gpt-4o', supported_endpoint_types: ['openai'] },
            { id: 'doubao-seedream-4-0-250828', supported_endpoint_types: ['image-generation'] },
          ],
        })
      )
    )

    const models = await client().listModels()
    expect(models.find(m => m.id === 'gpt-4o')?.endpoints).toEqual(['openai'])
    expect(models.find(m => m.id === 'doubao-seedream-4-0-250828')?.endpoints).toEqual([
      'image-generation',
    ])
  })

  it('网关直接返回数组也认', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ id: 'gpt-4o-mini' }])))

    const models = await client().listModels()
    expect(models.map(m => m.id)).toEqual(['gpt-4o-mini'])
  })
})

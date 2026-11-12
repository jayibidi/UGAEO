/**
 * OpenAI 兼容客户端
 *
 * 支持任意 OpenAI 协议兼容的中转站 / 自建网关：
 *   - POST {baseUrl}/chat/completions
 *   - GET  {baseUrl}/models
 *
 * 默认对接 Ugooto AI 中转站。
 */
import { AI_BASE_URL } from '../endpoints'

/** 默认中转站地址（OpenAI 兼容，含 /v1）；域名统一由 endpoints.ts 提供 */
export const DEFAULT_AI_BASE_URL = AI_BASE_URL

/** 默认模型 */
export const DEFAULT_AI_MODEL = 'gpt-4o-mini'

export interface AIConfig {
  provider?: 'openai' | 'claude' | 'local' | 'none'
  apiKey?: string
  /** 形如 https://api.ugooto-ai.com/v1 */
  baseUrl?: string
  model?: string
  /** 0 ~ 2，默认 0.7 */
  temperature?: number
  /** 单次请求超时（毫秒），默认 90s */
  timeout?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
  signal?: AbortSignal
}

export interface ModelInfo {
  id: string
  ownedBy?: string
}

/** AI 请求错误，带可读的中文提示 */
export class AIError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AIError'
    this.status = status
  }
}

/**
 * 规范化 Base URL
 * - 去掉尾部斜杠
 * - 若用户填了完整 chat/completions 地址，则回退到 /v1 根路径
 * - 若既没有 /v1 也没有版本段，自动补 /v1
 */
export function normalizeBaseUrl(input?: string): string {
  const raw = (input || DEFAULT_AI_BASE_URL).trim()
  if (!raw) return DEFAULT_AI_BASE_URL

  let url = raw.replace(/\/+$/, '')
  url = url.replace(/\/chat\/completions$/i, '')

  // 已经带版本段（/v1、/v2、/openai/v1 等）则不再追加
  if (/\/v\d+[a-z0-9-]*$/i.test(url)) return url
  // 兼容 .../compatible-mode 这类不带版本的中转路径
  if (/\/api$/i.test(url)) return `${url}/v1`

  return `${url}/v1`
}

function buildUrl(baseUrl: string | undefined, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`
}

/**
 * 把 HTTP 错误翻译成可读中文
 */
function describeHttpError(status: number, body: string): string {
  const detail = body.slice(0, 300)
  switch (status) {
    case 400:
      return `请求参数有误（400）：${detail}`
    case 401:
      return 'API Key 无效或已过期（401），请检查中转站密钥'
    case 402:
      return '账户额度不足（402），请前往中转站充值'
    case 403:
      return '无权访问该模型（403），请确认密钥权限与模型名'
    case 404:
      return `接口地址或模型不存在（404），请检查 Base URL 与模型名：${detail}`
    case 429:
      return '请求过于频繁或并发超限（429），请稍后重试'
    case 500:
    case 502:
    case 503:
    case 504:
      return `中转站服务异常（${status}），请稍后重试：${detail}`
    default:
      return `请求失败（${status}）：${detail}`
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      const err = json.error
      if (typeof err === 'string') return err
      if (err?.message) return err.message
      if (json.message) return json.message
    } catch {
      // 非 JSON，直接返回文本
    }
    return text
  } catch {
    return ''
  }
}

/**
 * OpenAI 兼容客户端
 */
export class OpenAICompatibleClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly defaultModel: string
  private readonly temperature: number
  private readonly timeout: number

  constructor(config: AIConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.apiKey = (config.apiKey || '').trim()
    this.defaultModel = config.model || DEFAULT_AI_MODEL
    this.temperature = config.temperature ?? 0.7
    this.timeout = config.timeout ?? 90_000
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    return headers
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeout: number,
    outerSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const onAbort = () => controller.abort()
    outerSignal?.addEventListener('abort', onAbort)

    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AIError(`AI 请求超时（${Math.round(timeout / 1000)}秒）`)
      }
      throw new AIError(`网络请求失败：${(error as Error).message}`)
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * 拉取可用模型列表
   */
  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetchWithTimeout(
      buildUrl(this.baseUrl, '/models'),
      { method: 'GET', headers: this.headers() },
      30_000
    )

    if (!response.ok) {
      throw new AIError(describeHttpError(response.status, await readErrorBody(response)), response.status)
    }

    const data = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
    const models = (data.data || [])
      .filter(m => typeof m.id === 'string' && m.id)
      .map(m => ({ id: m.id as string, ownedBy: m.owned_by }))

    return models.sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * 对话补全（非流式）
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body = {
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature ?? this.temperature,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      stream: false,
    }

    const response = await this.fetchWithTimeout(
      buildUrl(this.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      options.timeout ?? this.timeout,
      options.signal
    )

    if (!response.ok) {
      throw new AIError(describeHttpError(response.status, await readErrorBody(response)), response.status)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null }; text?: string }>
      error?: { message?: string }
    }

    if (data.error?.message) {
      throw new AIError(data.error.message)
    }

    const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? ''
    if (!content.trim()) {
      throw new AIError('模型返回了空内容，请更换模型或稍后重试')
    }
    return content
  }

  /**
   * 连通性测试：发一条极短的请求
   */
  async test(): Promise<{ ok: boolean; model: string; latency: number; sample?: string }> {
    const started = Date.now()
    const content = await this.chat(
      [
        { role: 'system', content: '你是一个连通性测试助手。' },
        { role: 'user', content: '回复两个字：正常' },
      ],
      { maxTokens: 16, temperature: 0 }
    )
    return {
      ok: true,
      model: this.defaultModel,
      latency: Date.now() - started,
      sample: content.trim().slice(0, 50),
    }
  }
}

/**
 * 从模型输出中提取 JSON（兼容 ```json 包裹、前后多余文字）
 */
export function extractJSON<T>(text: string): T | null {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/```json/gi, '```')
    .trim()

  const fenced = cleaned.match(/```([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : cleaned

  const tryParse = (input: string): T | null => {
    try {
      return JSON.parse(input) as T
    } catch {
      return null
    }
  }

  const direct = tryParse(candidate.trim())
  if (direct) return direct

  // 截取第一个 { 或 [ 到最后一个 } 或 ]
  const start = candidate.search(/[[{]/)
  const endBrace = candidate.lastIndexOf('}')
  const endBracket = candidate.lastIndexOf(']')
  const end = Math.max(endBrace, endBracket)
  if (start >= 0 && end > start) {
    return tryParse(candidate.slice(start, end + 1))
  }
  return null
}

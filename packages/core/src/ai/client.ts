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
import { extractEndpointTypes } from './model-catalog'

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
  /** 网关声明的能力（NewAPI 系 `supported_endpoint_types`），用于区分文本 / 生图模型 */
  endpoints?: string[]
}

export interface GenerateImageOptions {
  /** 生图模型名；不传用客户端默认模型 */
  model?: string
  /** 形如 1024x1024，不传则由服务端取默认尺寸 */
  size?: string
  /** 出图张数，默认 1 */
  n?: number
  timeout?: number
  signal?: AbortSignal
}

export interface GeneratedImage {
  /** 接口直接返回 base64 时给出的 dataURL */
  dataUrl?: string
  /** 接口只给图片地址时给出的 URL，由调用方决定要不要下载 */
  url?: string
  /** 部分模型会返回改写后的提示词 */
  revisedPrompt?: string
  model: string
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

    const payload = (await response.json()) as
      | { data?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    // 少数网关直接返回数组，别因为少一层 data 就报「拉不到模型」
    const rows = Array.isArray(payload) ? payload : payload.data || []

    const models = rows
      .filter(m => typeof m?.id === 'string' && m.id)
      .map(m => {
        const endpoints = extractEndpointTypes(m)
        return {
          id: m.id as string,
          ownedBy: typeof m.owned_by === 'string' ? m.owned_by : undefined,
          ...(endpoints.length ? { endpoints } : {}),
        }
      })

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
   * 文生图（OpenAI 兼容 POST /images/generations）
   *
   * 中转站之间差异很大，这里做三件保命的事：
   * 1. 先要 b64_json；部分网关不认 response_format，400 且错误信息提到它时去掉重试一次
   * 2. b64 / url 两种返回都接（url 由调用方决定要不要下载成 dataURL）
   * 3. 没拿到图就报可读的中文错误，而不是把 JSON 解析异常抛给用户
   */
  async generateImage(prompt: string, options: GenerateImageOptions = {}): Promise<GeneratedImage> {
    const text = prompt.trim()
    if (!text) throw new AIError('请先描述你想要的配图')

    const model = options.model?.trim() || this.defaultModel
    const buildBody = (withFormat: boolean) => ({
      model,
      prompt: text,
      n: options.n ?? 1,
      ...(options.size ? { size: options.size } : {}),
      ...(withFormat ? { response_format: 'b64_json' } : {}),
    })

    const request = (withFormat: boolean) =>
      this.fetchWithTimeout(
        buildUrl(this.baseUrl, '/images/generations'),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(buildBody(withFormat)),
        },
        options.timeout ?? this.timeout,
        options.signal
      )

    let response = await request(true)
    if (response.status === 400) {
      const body = await readErrorBody(response)
      // 只有确实卡在 response_format 上才重试；尺寸/提示词不合规要原样报给用户
      if (/response_format|b64|unknown (field|parameter)/i.test(body)) {
        response = await request(false)
      } else {
        throw new AIError(describeHttpError(400, body), 400)
      }
    }

    if (!response.ok) {
      throw new AIError(describeHttpError(response.status, await readErrorBody(response)), response.status)
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
      images?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
      error?: { message?: string }
    }
    if (payload.error?.message) throw new AIError(payload.error.message)

    const first = payload.data?.[0] ?? payload.images?.[0]
    const b64 = first?.b64_json?.trim()
    if (b64) {
      return { dataUrl: base64ToDataUrl(b64), revisedPrompt: first?.revised_prompt, model }
    }
    if (first?.url) {
      return { url: first.url, revisedPrompt: first?.revised_prompt, model }
    }
    throw new AIError('生图接口没有返回图片，请确认所选模型支持 /images/generations')
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
 * base64 图片转 dataURL
 *
 * 接口不一定声明 mime，按文件头猜：PNG `iVBOR`、JPEG `/9j/`、WebP `UklGR`、GIF `R0lGOD`。
 */
function base64ToDataUrl(base64: string): string {
  if (/^data:/i.test(base64)) return base64
  let mime = 'image/png'
  if (base64.startsWith('/9j/')) mime = 'image/jpeg'
  else if (base64.startsWith('UklGR')) mime = 'image/webp'
  else if (base64.startsWith('R0lGOD')) mime = 'image/gif'
  return `data:${mime};base64,${base64}`
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

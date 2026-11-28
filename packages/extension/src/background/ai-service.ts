/**
 * AI 服务：在 background 中调用大模型
 *
 * 好处：
 * - API Key 不会下发到 content script / 页面上下文
 * - 复用 service worker 的网络权限，无跨域限制
 */
import {
  OpenAICompatibleClient,
  OpenAIProcessor,
  htmlToMarkdown,
  normalizeBaseUrl,
  splitModelCatalog,
  type AIConfig,
  type ChatMessage,
  type DraftLength,
  type ModelCatalog,
  type RewriteMode,
} from '@ugaeo/core'
import { getAISettings, toAIConfig, type AISettings } from '../lib/ai-settings'
import { createLogger } from '../lib/logger'

const logger = createLogger('AIService')

export interface AITaskBase {
  /** 覆盖默认模型（用于「选择不同模型」） */
  model?: string
  temperature?: number
}

export type AITask =
  | ({ type: 'title'; title: string; platform: string; /** 平台标题上限，超了会被拒 */ maxLen?: number } & AITaskBase)
  | ({ type: 'summary'; content: string; maxLength?: number } & AITaskBase)
  | ({ type: 'tags'; content: string; platform: string } & AITaskBase)
  | ({
      type: 'adapt'
      content: string
      title?: string
      targetPlatform: string
      targetPlatformName?: string
      sourcePlatform?: string
    } & AITaskBase)
  | ({
      /**
       * 自动发布计划：一次产出该平台的标题 / 摘要 / 标签
       *
       * 自动发布一次要覆盖十几个平台，分开问「标题、摘要、标签」三遍会等三倍时间，
       * 所以合成一个任务；解析失败时返回 null，调用方退回规则标题。
       */
      type: 'brief'
      title: string
      content: string
      platform: string
      platformName?: string
      titleMax?: number
      tagCount?: number
      summaryMax?: number
      styleHint?: string
    } & AITaskBase)
  | ({
      /** 正文加工：润色 / 扩写 / 精简 */
      type: 'rewrite'
      content: string
      mode: RewriteMode
      title?: string
    } & AITaskBase)
  | ({
    /**
     * 从标题 / 提示词生成整篇稿（编辑器 AI 文案框）
     *
     * 一次产出标题 / 摘要 / 标签 / Markdown 正文，避免生成完再补三次请求。
     */
    type: 'draft'
    prompt: string
    title?: string
    length?: DraftLength
  } & AITaskBase)
  | ({
      /** AI 配图：走生图模型 + /images/generations */
      type: 'image'
      prompt: string
      size?: string
    } & AITaskBase)
  | ({
      /**
       * 通用多轮对话（控制台「AI 对话」页）
       *
       * 和上面那些任务不同：它们各自有固定提示词与结构化输出，这里要的是
       * 原样保留上下文自由对话，所以直接走 client.chat，不经过 processor。
       */
      type: 'chat'
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      /** 覆盖默认人设 */
      system?: string
      maxTokens?: number
    } & AITaskBase)

/** 生图结果：统一给 dataURL，编辑器直接内联进正文，不依赖图床 */
export interface AIImageResult {
  dataUrl: string
  model: string
  revisedPrompt?: string
}

export interface AIResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

function configFrom(settings: AISettings, task?: AITaskBase, fallbackModel?: string): AIConfig {
  const base = toAIConfig(settings)
  return {
    ...base,
    model: task?.model || fallbackModel || base.model,
    temperature: task?.temperature ?? base.temperature,
  }
}

/**
 * 配置是否齐全
 *
 * 生图任务要用「生图模型」，不能拿文本模型去糊（大多数中转站会直接 400）。
 */
function ensureReady(settings: AISettings, kind: 'text' | 'image'): string | null {
  if (!settings.enabled) return 'AI 功能未开启，请到「设置 → 发布与智能 → AI 模型」中开启'
  if (!settings.apiKey?.trim()) return '尚未填写 API Key，请到「设置 → 发布与智能 → AI 模型」中添加'
  if (kind === 'image' && !settings.imageModel?.trim()) {
    return '尚未选择生图模型，请到「设置 → 发布与智能 → AI 模型 → 生图模型（AI 配图）」中选择'
  }
  if (kind === 'text' && !settings.model?.trim()) return '尚未选择文本模型'
  return null
}

/**
 * 拉取模型列表（允许用尚未保存的配置直接测试）
 */
export async function listModels(params?: {
  baseUrl?: string
  apiKey?: string
}): Promise<AIResponse<string[]>> {
  try {
    const settings = await getAISettings()
    const client = new OpenAICompatibleClient({
      baseUrl: params?.baseUrl?.trim() || settings.baseUrl,
      apiKey: params?.apiKey?.trim() || settings.apiKey,
      model: settings.model,
    })
    const models = await client.listModels()
    const ids = models.map(m => m.id)
    logger.info(`Loaded ${ids.length} models from ${normalizeBaseUrl(params?.baseUrl || settings.baseUrl)}`)
    return { ok: true, data: ids }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 连通性测试
 */
export async function testConnection(params?: {
  baseUrl?: string
  apiKey?: string
  model?: string
}): Promise<AIResponse<{ model: string; latency: number; sample?: string }>> {
  try {
    const settings = await getAISettings()
    const client = new OpenAICompatibleClient({
      baseUrl: params?.baseUrl?.trim() || settings.baseUrl,
      apiKey: params?.apiKey?.trim() || settings.apiKey,
      model: params?.model?.trim() || settings.model,
    })
    const result = await client.test()
    return { ok: true, data: { model: result.model, latency: result.latency, sample: result.sample } }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 拉取模型库并分好类
 *
 * 设置页要两个下拉（文本模型 / 生图模型），所以一次拉取就分好组：
 * 网关给了 `supported_endpoint_types` 就按声明分，没给就按名称规则兜底，
 * 并把「有没有元信息」一起返回，让界面能说清分类可信度。
 */
export async function listModelLibrary(params?: {
  baseUrl?: string
  apiKey?: string
}): Promise<AIResponse<ModelCatalog>> {
  try {
    const settings = await getAISettings()
    const baseUrl = params?.baseUrl?.trim() || settings.baseUrl
    const client = new OpenAICompatibleClient({
      baseUrl,
      apiKey: params?.apiKey?.trim() || settings.apiKey,
      model: settings.model,
    })

    const models = await client.listModels()
    const catalog = splitModelCatalog(
      models.map(model => ({ id: model.id, supported_endpoint_types: model.endpoints }))
    )
    logger.info(
      `Model library: ${catalog.total} total · chat ${catalog.chat.length} · image ${catalog.image.length} · meta=${catalog.metaAvailable} · ${normalizeBaseUrl(baseUrl)}`
    )
    return { ok: true, data: catalog }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

const BASE64_CHUNK = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK))
  }
  return btoa(binary)
}

/**
 * 把接口返回的图片地址下载成 dataURL
 *
 * 为什么不直接把 URL 塞进正文：多数中转站的图片地址是带签名的临时链接，
 * 几个小时就失效，平台审核时抓到的是裂图；而且不少 CDN 有防盗链。
 */
async function downloadAsDataUrl(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`下载生成的图片失败（HTTP ${response.status}）`)
    }
    const type = response.headers.get('content-type') || 'image/png'
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length) throw new Error('下载到的图片是空的')
    return `data:${type.split(';')[0]};base64,${bytesToBase64(bytes)}`
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('下载生成的图片超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 通用对话的默认人设
 *
 * 这个页面是给「想写点什么但还没想清楚」用的：选题、起标题、列大纲、改稿都要能接。
 * 明确要求 Markdown，因为回复会直接被贴进正文。
 */
const CHAT_SYSTEM = `你是 UG·AEO 的中文内容创作助手，服务对象是在多平台发布内容的作者。

回答要求：
- 中文，直接给结果，不写「好的，我来帮你」这类开场白
- 需要正文、大纲、标题列表时用 Markdown（## 小标题、有序/无序列表），便于直接贴进编辑器
- 用户没说平台时默认按公众号 / 知乎的阅读习惯写；说了平台就按那个平台的调性
- 不确定的信息不要编，直接问用户或说明需要什么信息`

/**
 * 组装对话消息
 *
 * 单独抽出来是为了能脱离网络单测：system 用调用方给的还是默认人设、
 * 空内容会不会被塞进去，这两点是「对话突然失忆 / 报 400」的常见原因。
 */
export function buildChatMessages(task: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  system?: string
}): ChatMessage[] {
  return [
    { role: 'system', content: task.system?.trim() || CHAT_SYSTEM },
    ...task.messages
      .filter(message => message.content?.trim())
      .map(message => ({ role: message.role, content: message.content })),
  ]
}

/**
 * 执行 AI 任务
 */
export async function runAITask(task: AITask): Promise<AIResponse<unknown>> {
  const settings = await getAISettings()
  const notReady = ensureReady(settings, task.type === 'image' ? 'image' : 'text')
  if (notReady) return { ok: false, error: notReady }

  // 生图走独立接口（/images/generations），不经过 chat 处理器
  if (task.type === 'image') {
    try {
      const client = new OpenAICompatibleClient(configFrom(settings, task, settings.imageModel))
      const image = await client.generateImage(task.prompt, { size: task.size })
      const dataUrl = image.dataUrl ?? (image.url ? await downloadAsDataUrl(image.url) : '')
      if (!dataUrl) return { ok: false, error: '生图接口没有返回可用的图片' }

      const result: AIImageResult = {
        dataUrl,
        model: image.model,
        ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
      }
      logger.info(`Image generated by ${image.model} (${Math.round(dataUrl.length / 1024)} KB)`)
      return { ok: true, data: result }
    } catch (error) {
      logger.warn('AI image failed:', (error as Error).message)
      return { ok: false, error: (error as Error).message }
    }
  }

  // 通用对话同样绕过 processor：那边是面向具体任务的固定提示词
  if (task.type === 'chat') {
    try {
      const client = new OpenAICompatibleClient(configFrom(settings, task))
      const text = await client.chat(buildChatMessages(task), {
        maxTokens: task.maxTokens ?? 3000,
        // 长文生成不设 30 秒的话，接口默认超时会把还没写完的请求掐掉
        timeout: 180_000,
      })
      if (!text.trim()) return { ok: false, error: 'AI 没有返回内容，换个说法再试' }
      logger.info(`Chat replied ${text.length} chars`)
      return { ok: true, data: text }
    } catch (error) {
      logger.warn('AI chat failed:', (error as Error).message)
      return { ok: false, error: (error as Error).message }
    }
  }

  let processor: OpenAIProcessor
  try {
    processor = new OpenAIProcessor(configFrom(settings, task))
  } catch (error) {
    return { ok: false, error: `AI 配置无效：${(error as Error).message}` }
  }

  try {
    switch (task.type) {
      case 'title': {
        const titles = await processor.optimizeTitle(task.title, task.platform, task.maxLen)
        return { ok: true, data: titles }
      }
      case 'summary': {
        const summary = await processor.generateSummary(task.content, task.maxLength ?? 200)
        return { ok: true, data: summary }
      }
      case 'tags': {
        const tags = await processor.suggestTags(task.content, task.platform)
        return { ok: true, data: tags }
      }
      case 'brief': {
        if (!processor.planPublish) {
          return { ok: false, error: '当前 AI 实现不支持发布计划' }
        }
        const brief = await processor.planPublish({
          title: task.title,
          content: task.content,
          platformId: task.platform,
          platformName: task.platformName || task.platform,
          titleMax: task.titleMax,
          tagCount: task.tagCount,
          summaryMax: task.summaryMax,
          styleHint: task.styleHint,
        })
        if (!brief) return { ok: false, error: 'AI 未能生成发布计划' }
        return { ok: true, data: brief }
      }
      case 'adapt': {
        // 优先使用 Markdown 原文；只有 HTML 时先转换，保证模型看到的是结构化文本
        const looksLikeHtml = /<\/?(p|div|section|h[1-6]|ul|ol|li|img|br|pre|table)\b/i.test(task.content)
        const content = looksLikeHtml ? htmlToMarkdown(task.content) : task.content
        const markdown = await processor.adaptContent(
          content,
          task.sourcePlatform || 'unknown',
          task.targetPlatform,
          { title: task.title, platformName: task.targetPlatformName }
        )
        return { ok: true, data: markdown }
      }
      case 'rewrite': {
        // 与 adapt 一样，统一让模型看到 Markdown，避免 HTML 噪声影响改写质量
        const looksLikeHtml = /<\/?(p|div|section|h[1-6]|ul|ol|li|img|br|pre|table)\b/i.test(task.content)
        const content = looksLikeHtml ? htmlToMarkdown(task.content) : task.content
        const rewritten = await processor.rewriteContent(content, task.mode, { title: task.title })
        return { ok: true, data: rewritten }
      }
      case 'draft': {
        if (!processor.generateDraft) {
          return { ok: false, error: '当前 AI 实现不支持一键成稿' }
        }
        const draft = await processor.generateDraft({
          prompt: task.prompt,
          title: task.title,
          length: task.length,
        })
        return { ok: true, data: draft }
      }
      default:
        return { ok: false, error: '未知的 AI 任务类型' }
    }
  } catch (error) {
    logger.error('AI task failed:', task.type, error)
    return { ok: false, error: (error as Error).message }
  }
}

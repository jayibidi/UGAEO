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
  type AIConfig,
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

export interface AIResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

function configFrom(settings: AISettings, task?: AITaskBase): AIConfig {
  const base = toAIConfig(settings)
  return {
    ...base,
    model: task?.model || base.model,
    temperature: task?.temperature ?? base.temperature,
  }
}

function ensureReady(settings: AISettings): string | null {
  if (!settings.enabled) return 'AI 功能未开启，请到「设置 → AI 模型」中开启'
  if (!settings.apiKey?.trim()) return '尚未填写 API Key'
  if (!settings.model?.trim()) return '尚未选择模型'
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
 * 执行 AI 任务
 */
export async function runAITask(task: AITask): Promise<AIResponse<unknown>> {
  const settings = await getAISettings()
  const notReady = ensureReady(settings)
  if (notReady) return { ok: false, error: notReady }

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
      default:
        return { ok: false, error: '未知的 AI 任务类型' }
    }
  } catch (error) {
    logger.error('AI task failed:', task.type, error)
    return { ok: false, error: (error as Error).message }
  }
}

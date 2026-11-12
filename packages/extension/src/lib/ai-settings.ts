/**
 * AI 设置：持久化 + 类型
 *
 * API Key 只保存在浏览器本地 chrome.storage.local，不经过任何第三方服务器。
 */
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  isAIConfigured as coreIsAIConfigured,
  type AIConfig,
} from '@ugaeo/core'

export const AI_SETTINGS_KEY = 'aiSettings'

export interface AIFeatureToggles {
  /** 标题优化 */
  title: boolean
  /** 摘要生成 */
  summary: boolean
  /** 标签推荐 */
  tags: boolean
  /** 多平台风格适配 */
  adapt: boolean
}

export interface AISettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  /** 最近一次拉取的模型列表 */
  models: string[]
  temperature: number
  features: AIFeatureToggles
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  baseUrl: DEFAULT_AI_BASE_URL,
  apiKey: '',
  model: DEFAULT_AI_MODEL,
  models: [],
  temperature: 0.7,
  features: {
    title: true,
    summary: true,
    tags: true,
    adapt: true,
  },
}

function normalize(raw: Partial<AISettings> | undefined): AISettings {
  if (!raw) return { ...DEFAULT_AI_SETTINGS, features: { ...DEFAULT_AI_SETTINGS.features } }
  return {
    ...DEFAULT_AI_SETTINGS,
    ...raw,
    features: { ...DEFAULT_AI_SETTINGS.features, ...(raw.features || {}) },
    models: Array.isArray(raw.models) ? raw.models : [],
  }
}

export async function getAISettings(): Promise<AISettings> {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY)
  return normalize(result[AI_SETTINGS_KEY] as Partial<AISettings> | undefined)
}

export async function saveAISettings(patch: Partial<AISettings>): Promise<AISettings> {
  const current = await getAISettings()
  const next = normalize({ ...current, ...patch })
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: next })
  return next
}

/** 转换为 core 的 AIConfig */
export function toAIConfig(settings: AISettings): AIConfig {
  return {
    provider: 'openai',
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: settings.temperature,
  }
}

/** AI 是否可用（已开启且 Key、模型齐全） */
export function isAIReady(settings: AISettings): boolean {
  return settings.enabled && coreIsAIConfigured(toAIConfig(settings))
}

/** 打码展示 API Key */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

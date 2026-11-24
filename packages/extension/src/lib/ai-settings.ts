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
  /** 文本模型：排版 / 文案 / 识图 */
  model: string
  /** 最近一次拉取的文本模型列表 */
  models: string[]
  /** 生图模型：AI 配图（与文本模型分开选，很多中转站两者不通用） */
  imageModel: string
  /** 最近一次拉取的生图模型列表 */
  imageModels: string[]
  temperature: number
  features: AIFeatureToggles
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  baseUrl: DEFAULT_AI_BASE_URL,
  apiKey: '',
  model: DEFAULT_AI_MODEL,
  models: [],
  imageModel: '',
  imageModels: [],
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
    // 旧版本没有生图模型字段，读出来必须是空串而不是 undefined（界面上会显示成 "undefined"）
    imageModel: typeof raw.imageModel === 'string' ? raw.imageModel : '',
    imageModels: Array.isArray(raw.imageModels) ? raw.imageModels : [],
  }
}

export async function getAISettings(): Promise<AISettings> {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY)
  return normalize(result[AI_SETTINGS_KEY] as Partial<AISettings> | undefined)
}

/**
 * 写入串行化
 *
 * saveAISettings 是「读 → 合并 → 写」，多个字段同时保存（改地址、改 Key、
 * 拉完模型回填列表）会并发读到同一份旧数据，最后写入的那次把前几次的改动覆盖掉。
 * 表现出来就是「地址明明填了，请求却打到默认中转站」。这里排成队列，后一次
 * 一定读到前一次的结果。
 */
let writeQueue: Promise<unknown> = Promise.resolve()

export async function saveAISettings(patch: Partial<AISettings>): Promise<AISettings> {
  const task = writeQueue.then(async () => {
    const current = await getAISettings()
    const next = normalize({ ...current, ...patch })
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: next })
    return next
  })
  // 队列不能因为某次失败就卡死：吞掉错误只影响这次的返回值
  writeQueue = task.catch(() => undefined)
  return task
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

/** AI 是否可用（已开启且 Key、文本模型齐全） */
export function isAIReady(settings: AISettings): boolean {
  return settings.enabled && coreIsAIConfigured(toAIConfig(settings))
}

/** 生图是否可用：生图模型与文本模型分开配置，缺一不可 */
export function isImageReady(settings: AISettings): boolean {
  return settings.enabled && !!settings.apiKey?.trim() && !!settings.imageModel?.trim()
}

/**
 * 编辑器里的 AI 面板为什么不能用
 *
 * 返回 null 表示可用；否则返回一句能直接显示给用户的话 + 该去改哪一项。
 * 「开关没开」和「没填 Key」要分开说，否则用户打开设置发现 Key 明明填了。
 */
export function describeAIBlocker(
  settings: AISettings,
  kind: 'text' | 'image'
): { message: string; fix: 'enable' | 'apiKey' | 'model' } | null {
  if (!settings.apiKey?.trim()) {
    return { message: '还没有填写 API Key，先去设置里添加一个', fix: 'apiKey' }
  }
  if (!settings.enabled) {
    return { message: 'AI 能力开关没打开，去设置里开启「启用 AI 能力」', fix: 'enable' }
  }
  if (kind === 'text' && !settings.model?.trim()) {
    return { message: '还没有选择文本模型，去设置里选一个（排版 / 文案 / 识图）', fix: 'model' }
  }
  if (kind === 'image' && !settings.imageModel?.trim()) {
    return { message: '还没有选择生图模型，去设置里选一个（AI 配图）', fix: 'model' }
  }
  return null
}

/** 打码展示 API Key */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

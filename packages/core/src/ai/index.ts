/**
 * AI 能力入口
 *
 * - AIProcessor：与具体模型无关的能力接口
 * - OpenAIProcessor：OpenAI 兼容实现（支持中转站）
 * - NoopAIProcessor：无 AI 时的空实现，保证同步链路不受影响
 */
import { OpenAIProcessor } from './processor'
import type { AIConfig } from './client'
import type { RewriteMode } from './prompts'

export * from './client'
export * from './prompts'
export { OpenAIProcessor, htmlToPlainText } from './processor'
export type { AdaptOptions } from './processor'

/**
 * AI 处理器接口
 */
export interface AIProcessor {
  /**
   * 优化文章标题
   * @param title 原标题
   * @param platform 目标平台
   * @returns 优化后的标题选项
   */
  optimizeTitle(title: string, platform: string): Promise<string[]>

  /**
   * 生成文章摘要
   * @param content 文章内容 (HTML)
   * @param maxLength 最大长度
   */
  generateSummary(content: string, maxLength?: number): Promise<string>

  /**
   * 推荐标签
   * @param content 文章内容
   * @param platform 目标平台
   */
  suggestTags(content: string, platform: string): Promise<string[]>

  /**
   * 跨平台内容适配
   * @param content 原内容
   * @param sourcePlatform 来源平台
   * @param targetPlatform 目标平台
   * @param options 额外上下文（标题、平台名称等）
   */
  adaptContent(
    content: string,
    sourcePlatform: string,
    targetPlatform: string,
    options?: { title?: string; platformName?: string }
  ): Promise<string>

  /**
   * 正文加工（润色 / 扩写 / 精简）
   * @param content 正文（Markdown 或纯文本）
   * @param mode 加工模式
   * @param options 额外上下文（标题）
   */
  rewriteContent(
    content: string,
    mode?: RewriteMode,
    options?: { title?: string }
  ): Promise<string>
}

/**
 * 空实现 AI 处理器
 * 直接返回原值，不做任何处理
 */
export class NoopAIProcessor implements AIProcessor {
  async optimizeTitle(title: string): Promise<string[]> {
    return [title]
  }

  async generateSummary(content: string, maxLength = 200): Promise<string> {
    // 简单截取纯文本
    const text = content.replace(/<[^>]+>/g, '').trim()
    if (text.length <= maxLength) {
      return text
    }
    return text.slice(0, maxLength - 3) + '...'
  }

  async suggestTags(): Promise<string[]> {
    return []
  }

  async adaptContent(content: string): Promise<string> {
    return content
  }

  async rewriteContent(content: string): Promise<string> {
    return content
  }
}

/**
 * AI 处理器工厂
 */
export type AIProcessorFactory = () => AIProcessor

/**
 * 默认 AI 处理器实例
 */
export const defaultAIProcessor = new NoopAIProcessor()

/**
 * 创建 AI 处理器
 * - 提供 baseUrl + apiKey + model 时返回 OpenAI 兼容处理器
 * - 否则退化为空实现
 */
export function createAIProcessor(config?: AIConfig): AIProcessor {
  if (!config || config.provider === 'none') {
    return new NoopAIProcessor()
  }
  if (!config.apiKey) {
    return new NoopAIProcessor()
  }
  try {
    return new OpenAIProcessor(config)
  } catch {
    return new NoopAIProcessor()
  }
}

/**
 * 判断配置是否具备可用的 AI 能力
 */
export function isAIConfigured(config?: AIConfig | null): boolean {
  return !!config?.apiKey?.trim() && !!config?.model?.trim()
}

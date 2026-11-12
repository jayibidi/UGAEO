/**
 * OpenAI 兼容 AI 处理器
 *
 * 实现 AIProcessor 接口，所有能力都通过中转站的 /chat/completions 完成。
 */
import type { AIProcessor } from './index'
import {
  OpenAICompatibleClient,
  extractJSON,
  normalizeBaseUrl,
  type AIConfig,
} from './client'
import {
  SYSTEM_EDITOR,
  REWRITE_MODES,
  adaptPrompt,
  platformStyleHint,
  rewritePrompt,
  summaryPrompt,
  tagsPrompt,
  titlePrompt,
  type RewriteMode,
} from './prompts'

const MAX_PROMPT_CHARS = 24_000

/**
 * 去掉 HTML 标签，压缩空白
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(text: string, max = MAX_PROMPT_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n…（正文过长，已截断）`
}

export interface AdaptOptions {
  /** 文章标题，帮助模型理解上下文 */
  title?: string
  /** 平台展示名，用于提示词 */
  platformName?: string
  /** 来源平台 */
  sourcePlatform?: string
}

/**
 * OpenAI 兼容 AI 处理器
 */
export class OpenAIProcessor implements AIProcessor {
  readonly client: OpenAICompatibleClient

  constructor(config: AIConfig) {
    this.client = new OpenAICompatibleClient({
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
    })
  }

  async optimizeTitle(title: string, platform: string): Promise<string[]> {
    try {
      const raw = await this.client.chat(
        [
          { role: 'system', content: SYSTEM_EDITOR },
          { role: 'user', content: titlePrompt(title, platform, 5) },
        ],
        { temperature: 0.9, maxTokens: 800 }
      )
      const parsed = extractJSON<{ titles?: string[] }>(raw)
      const titles = (parsed?.titles || []).map(t => String(t).trim()).filter(Boolean)
      return titles.length > 0 ? titles.slice(0, 5) : [title]
    } catch {
      // 标题优化失败不应阻塞同步流程
      return [title]
    }
  }

  async generateSummary(content: string, maxLength = 200): Promise<string> {
    try {
      const raw = await this.client.chat(
        [
          { role: 'system', content: SYSTEM_EDITOR },
          { role: 'user', content: summaryPrompt(truncate(htmlToPlainText(content), 6000), maxLength) },
        ],
        { temperature: 0.4, maxTokens: 500 }
      )
      const parsed = extractJSON<{ summary?: string }>(raw)
      const summary = (parsed?.summary || raw || '').trim()
      return summary.slice(0, maxLength)
    } catch {
      const text = htmlToPlainText(content)
      return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`
    }
  }

  async suggestTags(content: string, platform: string): Promise<string[]> {
    const raw = await this.client.chat(
      [
        { role: 'system', content: SYSTEM_EDITOR },
        { role: 'user', content: tagsPrompt(truncate(htmlToPlainText(content), 6000), platform) },
      ],
      { temperature: 0.3, maxTokens: 400 }
    )
    const parsed = extractJSON<{ tags?: string[] }>(raw)
    if (parsed?.tags?.length) {
      return parsed.tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 8)
    }
    // 兜底：按行/逗号切分
    return raw
      .split(/[\n,，、]/)
      .map(t => t.replace(/^[-*\d.\s#]+/, '').trim())
      .filter(t => t.length >= 2 && t.length <= 12)
      .slice(0, 8)
  }

  /**
   * 跨平台内容适配
   * @param content Markdown 或纯文本正文
   */
  async adaptContent(
    content: string,
    sourcePlatform: string,
    targetPlatform: string,
    options: AdaptOptions = {}
  ): Promise<string> {
    // 全文改写必须完整，超长文章直接拒绝，避免产出被截断的版本
    if (content.length > MAX_PROMPT_CHARS) {
      throw new Error(`文章约 ${content.length} 字，超过 AI 全文改写的上限（${MAX_PROMPT_CHARS} 字），请改用标题/摘要/标签功能`)
    }

    const hint = platformStyleHint(targetPlatform, options.platformName)
    const raw = await this.client.chat(
      [
        { role: 'system', content: SYSTEM_EDITOR },
        {
          role: 'user',
          content: adaptPrompt({
            title: options.title || '',
            content: truncate(content),
            platformId: targetPlatform,
            platformName: options.platformName || targetPlatform,
            sourcePlatform: options.sourcePlatform || sourcePlatform,
          }),
        },
      ],
      { temperature: 0.6, maxTokens: 4096 }
    )
    return stripCodeFence(raw, hint)
  }

  /**
   * 正文加工：润色 / 扩写 / 精简
   *
   * 与 adaptContent 的区别是「不换平台调性」，只做通用写作层面的加工，
   * 结果可回填为新的正文再次分发到各平台。
   */
  async rewriteContent(
    content: string,
    mode: RewriteMode = 'polish',
    options: { title?: string } = {}
  ): Promise<string> {
    if (content.length > MAX_PROMPT_CHARS) {
      throw new Error(
        `文章约 ${content.length} 字，超过 AI 全文加工的上限（${MAX_PROMPT_CHARS} 字），请分段处理`
      )
    }

    const spec = REWRITE_MODES[mode] || REWRITE_MODES.polish
    const raw = await this.client.chat(
      [
        { role: 'system', content: SYSTEM_EDITOR },
        { role: 'user', content: rewritePrompt({ mode, content, title: options.title }) },
      ],
      { temperature: spec.temperature, maxTokens: 4096 }
    )

    const result = stripCodeFence(raw)
    if (!result.trim()) {
      throw new Error('AI 未返回内容，请重试或更换模型')
    }
    return result
  }
}

/**
 * 去掉模型可能加上的整篇代码块包裹
 */
function stripCodeFence(text: string, _hint?: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

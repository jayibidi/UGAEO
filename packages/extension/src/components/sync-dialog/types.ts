export interface Platform {
  id: string
  name: string
  icon: string
  homepage?: string
  isAuthenticated: boolean
  username?: string
  /** 平台能力，含 'publish' 表示支持自动发布 */
  capabilities?: string[]
  /** 'public' = 公开投稿入口，无需登录（不能显示成「已登录」） */
  authMode?: 'cookie' | 'public'
}

export interface Article {
  title: string
  content: string
  /** 已预处理的 HTML（存在时优先于 content） */
  html?: string
  summary?: string
  cover?: string
  tags?: string[]
  /** Markdown 原文（提取器提供），AI 适配优先使用 */
  markdown?: string
  /** 平台专属内容（AI 风格适配结果） */
  platformContents?: Record<string, { html: string; markdown: string }>
}

export interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  draftOnly?: boolean
  message?: string
  error?: string
  /** 发布后审核状态（知乎/掘金等支持查询的平台返回） */
  reviewStatus?: 'published' | 'reviewing' | 'rejected' | 'unknown'
  reviewStatusText?: string
}

export type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

export interface PlatformProgress {
  platform: string
  platformName: string
  stage: SyncStage
  imageProgress?: { current: number; total: number }
  error?: string
}

export type DialogStatus = 'loading' | 'idle' | 'syncing' | 'completed' | 'failed' | 'cancelled'

/** 发布模式（与 lib/publish-settings 保持一致） */
export type PublishMode = 'draft' | 'publish' | 'scheduled'

export interface SyncDialogProps {
  // Data
  article: Article | null
  platforms: Platform[]
  status: DialogStatus
  selectedPlatforms: string[]
  results: SyncResult[]
  platformProgress: Map<string, PlatformProgress>
  error: string | null
  /**
   * 没取到文章时的说明文案（页面是浏览器内部页 / content script 未注入等），
   * 与 error 分开：这不是同步失败，只是当前页面没内容可同步。
   */
  extractHint?: string | null

  // Actions
  onTogglePlatform: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onStartSync: () => void
  onRetryFailed: () => void
  onReset: () => void
  onCancel?: () => void

  // Optional
  onEditArticle?: () => void
  onClose?: () => void
  /** 刷新当前标签页（用于「扩展重载后旧标签页没有 content script」的自救） */
  onReloadTab?: () => void
  className?: string

  /** 当前发布模式 */
  publishMode?: PublishMode
  /** 切换发布模式（草稿 / 发布） */
  onTogglePublishMode?: () => void
  /** 定时发布时间（仅 scheduled 模式） */
  scheduledAt?: number | null
  /** AI 是否已就绪 */
  aiReady?: boolean
  /** 更新文章（AI 结果回填） */
  onUpdateArticle?: (patch: Partial<Article>) => void
  /**
   * 控制台模式：点击主按钮不再原地同步，而是进入独立 WEB 控制台
   * （账号登录状态查验、失败处理、返回编辑都在那里）
   */
  consoleMode?: boolean
}

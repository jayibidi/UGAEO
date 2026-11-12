/**
 * 文章内容
 *
 * 内容格式说明：
 * - markdown: 主要内容格式，由 content script 使用 Turndown + 原生 DOM 转换
 * - html: 可选的原始 HTML，某些平台可能需要
 */
export interface Article {
  title: string
  markdown: string    // Markdown 格式内容（主要）
  html?: string       // 原始 HTML（可选，用于某些需要 HTML 的平台）
  summary?: string
  cover?: string
  tags?: string[]
  category?: string
  source?: {
    url: string
    platform: string
  }
}

/**
 * 同步结果
 */
/**
 * 发布后的审核状态
 *
 * 只有部分平台（知乎、掘金）发布后会进入审核队列，
 * 需要通过发布后轮询才能确认最终是否真正上线。
 */
export type ReviewStatus = 'published' | 'reviewing' | 'rejected' | 'unknown'

export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean  // 是否只保存了草稿
  error?: string
  message?: string  // 额外提示信息
  /** 发布后的审核状态（仅支持查询的平台返回） */
  reviewStatus?: ReviewStatus
  /** 审核状态的可读文案，可直接展示给用户 */
  reviewStatusText?: string
  /** 是否已经轮询过审核状态 */
  reviewChecked?: boolean
  timestamp: number
}

/**
 * 认证状态
 */
export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
  /**
   * 登录态来源
   * - cookie（默认）：靠登录 Cookie 判断，界面上「已登录」就是说这个人真的登录了
   * - public：平台是公开投稿表单，本来就不需要登录。
   *   isAuthenticated 仍然为 true（不然会被同步流程过滤掉），
   *   但界面必须显示「无需登录」——不能谎报成「已登录」。
   */
  authMode?: 'cookie' | 'public'
}

/**
 * 平台能力
 */
export type PlatformCapability =
  | 'article'      // 发布文章
  | 'draft'        // 草稿支持
  | 'publish'      // 支持真正公开发布（非草稿）
  | 'image_upload' // 图片上传
  | 'categories'   // 分类
  | 'tags'         // 标签
  | 'cover'        // 封面图
  | 'schedule'     // 定时发布

/**
 * 平台元信息
 */
export interface PlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
  capabilities: PlatformCapability[]
}

/**
 * Cookie
 */
export interface Cookie {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

/**
 * Header 规则
 */
export interface HeaderRule {
  id?: string
  urlFilter: string
  headers: Record<string, string>
  resourceTypes?: string[]
}

/**
 * 请求选项
 */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown>
  timeout?: number
}

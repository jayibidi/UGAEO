/**
 * 文章内容
 *
 * 内容格式说明：
 * - markdown: 主要内容格式，由 content script 使用 Turndown + 原生 DOM 转换
 * - html: 可选的原始 HTML，某些平台可能需要
 */
/**
 * 单个平台的 AI 发布计划
 *
 * 结构与 `ai/publish-brief.ts` 的 PublishBrief 一致，这里内联一份是为了
 * 让 types 不反过来依赖 ai 模块（ai 已经依赖 types，双向引会成环）。
 */
export interface PlatformBrief {
  title: string
  summary: string
  tags: string[]
}

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
  /** 按平台覆盖标题（规则适配 / AI 改写的结果，同步时才生效） */
  platformTitles?: Record<string, string>
  /**
   * 按平台覆盖摘要 / 标签（AI 发布计划，自动发布时才会填）
   *
   * 只对「立即发布」生效：草稿模式没有意义，还会把 AI 的痕迹留在半成品里。
   */
  platformBriefs?: Record<string, PlatformBrief>
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
  /** 按平台规则 / AI 改过标题时的说明（原标题多少字、改成了什么） */
  titleNote?: string
  /**
   * 这次失败是因为登录态失效
   *
   * 页面实测发现被踢回登录页时置为 true：登录态缓存里的「已登录」是过期结论，
   * 调用方要立刻把它改成未登录，否则界面一直显示已登录、同步一直失败。
   */
  authExpired?: boolean
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
  | 'publish_existing_draft' // 能把「已存在的草稿」直接发布（草稿转发布）
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
  /**
   * 没有统一的文章编辑器
   *
   * 词条编辑（快懂百科）、投稿表单（IT之家 / InfoQ）、问答（百度知道）、
   * B2B 属性表单（八方 / 黄页88）都是这类：注入内容也发不出去，
   * 硬填只会产出审核不过的垃圾数据。账号页把它单独分到第三层。
   */
  noEditor?: boolean
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

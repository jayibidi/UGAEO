/**
 * 控制台共享类型
 *
 * 这些结构来自 background（CHECK_ALL_AUTH / syncHistory / articleSnapshots），
 * 只保留控制台用得到的字段。
 */

export interface Platform {
  id: string
  name: string
  icon: string
  homepage: string
  isAuthenticated: boolean
  username?: string
  /** 未登录时的具体原因（接口返回码、Cookie 缺失等），便于排查 */
  error?: string
  /** dsl = 平台适配器，cms = 自建站点 */
  sourceType: 'dsl' | 'cms'
  cmsType?: 'wordpress' | 'typecho' | 'metaweblog'
  /** 含 'publish' 表示支持直接公开发布 */
  capabilities?: string[]
  /**
   * 没有统一文章编辑器（词条 / 投稿 / 问答 / B2B 属性表单）
   *
   * 这类平台扩展只打开入口页，内容必须人工填 —— 账号页把它分到第三层。
   */
  noEditor?: boolean
  /**
   * 'public' = 平台是公开投稿表单，本来就不需要登录。
   * 这类平台 isAuthenticated 为 true（可用），但界面必须显示「无需登录」。
   */
  authMode?: 'cookie' | 'public'
  /**
   * 登录态还没测出来，需要点「重新检测」开页实测
   *
   * 企鹅号 / 简书 / 八方资源网这类平台的登录态在服务端 Session 里，Cookie 名猜不出来。
   * 被动刷新时不许开标签页，所以只能先标「待检测」——既不当成未登录踢出列表，
   * 也不假装已登录。
   */
  needsProbe?: boolean
}

export interface CmsAccount {
  id: string
  name: string
  type: 'wordpress' | 'typecho' | 'metaweblog'
  url: string
  username?: string
  isConnected?: boolean
}

export interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  /** 平台侧的文章 / 草稿 id，草稿转发布时要用 */
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  message?: string
  reviewStatus?: 'published' | 'reviewing' | 'rejected' | 'unknown'
  reviewStatusText?: string
  reviewChecked?: boolean
  /** 按平台规则 / AI 改过标题时的说明 */
  titleNote?: string
}

/** 一篇已经存在于平台草稿箱里的草稿 */
export interface DraftRef {
  platform: string
  platformName?: string
  postId?: string
  postUrl?: string
  title?: string
}

export type SyncStatus = 'syncing' | 'completed' | 'failed' | 'cancelled'

export interface HistoryItem {
  id: string
  status: SyncStatus
  title: string
  cover?: string
  platforms: string[]
  results: SyncResult[]
  startTime: number
  endTime?: number
}

export interface Article {
  title: string
  content?: string
  html?: string
  markdown?: string
  summary?: string
  cover?: string
  tags?: string[]
  /** 按平台覆盖标题（规则适配 / AI 改写的结果） */
  platformTitles?: Record<string, string>
  /** 按平台覆盖摘要 / 标签（AI 发布计划，立即发布时才生成） */
  platformBriefs?: Record<string, { title: string; summary: string; tags: string[] }>
  /** 正文里的图片数（飞书提取时统计，用于提示「含 N 张图」） */
  imageCount?: number
  source?: { url?: string; platform?: string }
  platformContents?: Record<string, { html: string; markdown: string }>
}

export interface ArticleSnapshot extends Article {
  syncId: string
  savedAt: number
}

export interface PlatformProgress {
  platform: string
  platformName: string
  stage: 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'
  error?: string
}

/** 某次同步里某个平台的一次失败 */
export interface FailureItem {
  syncId: string
  title: string
  platform: string
  platformName: string
  error: string
  message?: string
  postUrl?: string
  draftOnly?: boolean
  reviewStatus?: SyncResult['reviewStatus']
  time: number
  /** 失败原因归类，用于筛选与提示 */
  kind: 'auth' | 'publish' | 'unknown'
}

export interface Notice {
  kind: 'ok' | 'error' | 'info'
  text: string
}

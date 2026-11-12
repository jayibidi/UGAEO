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
   * 'public' = 平台是公开投稿表单，本来就不需要登录。
   * 这类平台 isAuthenticated 为 true（可用），但界面必须显示「无需登录」。
   */
  authMode?: 'cookie' | 'public'
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
  postUrl?: string
  draftOnly?: boolean
  error?: string
  message?: string
  reviewStatus?: 'published' | 'reviewing' | 'rejected' | 'unknown'
  reviewStatusText?: string
  reviewChecked?: boolean
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

import type { Article, AuthResult, SyncResult, PlatformMeta } from '../types'
import type { RuntimeInterface } from '../runtime/interface'

/**
 * 输出格式类型
 */
export type OutputFormat = 'html' | 'markdown'

/**
 * 预处理配置
 * 每个平台在 adapter 中定义自己需要的预处理选项
 * Content Script 根据这些配置在发送到 Service Worker 前进行预处理
 */
export interface PreprocessConfig {
  /** 输出格式: html 或 markdown */
  outputFormat: OutputFormat

  /** 移除链接标签，保留文字 */
  removeLinks?: boolean
  /** 保留的链接域名 */
  keepLinkDomains?: string[]

  /** 移除 iframe */
  removeIframes?: boolean
  /** 移除 HTML 注释 */
  removeComments?: boolean
  /** 移除微信特殊标签 (mpprofile, qqmusic 等) */
  removeSpecialTags?: boolean
  /** 移除特殊标签时同时移除其父元素（知乎等需要） */
  removeSpecialTagsWithParent?: boolean
  /** 移除 SVG 占位图片 */
  removeSvgImages?: boolean

  /** 处理代码块 */
  processCodeBlocks?: boolean
  /** 处理懒加载图片 (data-src → src) */
  processLazyImages?: boolean

  /** 移除空元素 (空 p, div, section 等) */
  removeEmptyElements?: boolean
  /** 移除没有有效 src 的 img 标签（src 为空或缺失） */
  removeEmptyImages?: boolean
  /** 移除 data-* 属性 */
  removeDataAttributes?: boolean
  /** 移除 srcset 属性 */
  removeSrcset?: boolean
  /** 移除 sizes 属性 */
  removeSizes?: boolean

  /** 将 section 转换为 div */
  convertSectionToDiv?: boolean
  /** 将 section 转换为 p */
  convertSectionToP?: boolean

  // 知乎等平台需要的额外处理
  /** 移除段落尾部的 br 标签 */
  removeTrailingBr?: boolean
  /** 解包单一子元素容器 */
  unwrapSingleChildContainers?: boolean
  /** 解包只含单个子 span 的 span（减少过深嵌套） */
  unwrapSingleChildSpans?: boolean
  /** 解包嵌套的 figure 标签 */
  unwrapNestedFigures?: boolean
  /** 展平嵌套的 b/strong 标签（移除内层，保留内容） */
  flattenNestedBold?: boolean
  /** 压缩 HTML（移除标签间空白） */
  compactHtml?: boolean

  /** 将表格转换为文本（用 | 分隔列，适用于不支持表格的平台） */
  convertTablesToText?: boolean

  /** 保留 <style> 标签（CLI 同步自定义 HTML 时使用） */
  keepStyles?: boolean

  // 清理空内容
  /** 移除空行（只含 br 或空白的段落） */
  removeEmptyLines?: boolean
  /** 移除空 div（只含 br 或空白，但保留含图片的） */
  removeEmptyDivs?: boolean
  /** 移除嵌套的空容器 */
  removeNestedEmptyContainers?: boolean

  /** 通过 Markdown 往返标准化内容（HTML→Markdown→HTML，清理多余结构，适用于非微信来源） */
  normalizeViaMarkdown?: boolean
}

/**
 * 默认预处理配置
 */
export const DEFAULT_PREPROCESS_CONFIG: PreprocessConfig = {
  outputFormat: 'html',
  removeIframes: true,
  removeComments: true,
  removeSpecialTags: true,
  removeSvgImages: true,
  processCodeBlocks: true,
  processLazyImages: true,
  removeEmptyElements: true,
  removeDataAttributes: true,
  removeEmptyImages: true,
  removeSrcset: true,
  removeSizes: true,
  normalizeViaMarkdown: false,
}

/**
 * 图片上传进度回调
 */
export type ImageProgressCallback = (current: number, total: number) => void

/**
 * 发布选项
 */
export interface PublishOptions {
  /**
   * 只保存草稿，不发布
   * - true（默认）：仅创建草稿
   * - false：在平台支持的前提下真正公开发布（meta.capabilities 含 'publish'）
   */
  draftOnly?: boolean
  /** 图片上传进度回调 */
  onImageProgress?: ImageProgressCallback
  /**
   * 发布后是否轮询审核状态
   * - undefined / true（默认）：发布后轮询，最长由 reviewTimeoutMs 控制
   * - false：不做轮询，发布接口成功即返回
   */
  checkReviewStatus?: boolean
  /** 审核状态轮询超时（毫秒），默认 30 秒 */
  reviewTimeoutMs?: number
}

/**
 * 已存在草稿的引用
 *
 * 「先存草稿，确认后再发布」需要把上一次同步创建的草稿标识带回来。
 * 只有声明了 publish_existing_draft 能力的平台才能直接发布它 ——
 * 其余平台宁可提示「去后台发布」，也不重新创建一篇造成重复内容。
 */
export interface DraftRef {
  /** 平台 id */
  platform: string
  /** 平台侧的草稿 / 文章 id（API 平台通常都会返回） */
  postId?: string
  /** 草稿编辑页（拿不到 id 时用于人工打开） */
  postUrl?: string
  /** 文章标题，仅用于界面展示 */
  title?: string
}

/**
 * 平台适配器接口
 */
/**
 * 平台自检信息
 *
 * 由适配器自己回答「我依赖什么」，让自检面板能对任意平台做统一检查，
 * 而不是在 UI 里硬编码每个平台的 cookie 名和选择器。
 */
export interface AdapterDiagnostics {
  /** api：直接调平台接口；page：靠浏览器打开页面填内容 */
  driver: 'api' | 'page'
  /** 是否需要登录态（false 表示公开表单，如投稿页） */
  requiresAuth: boolean
  /** 登录态判断依赖的 Cookie 名（driver=cookie 时才有意义） */
  authCookieNames: string[]
  /** 入口页 / 编辑器页地址 */
  entryUrl?: string
  /** 用来判断「这个 tab 是不是入口页」的 URL 片段 */
  entryUrlMatch?: string
  /** 编辑器形态：editor 能自助发布，submission 只能人工提交 */
  mode?: 'editor' | 'submission'
  /** 页面驱动时的选择器，供自检脚本统计命中数 */
  titleSelectors?: string[]
  editorSelectors?: string[]
  publishTexts?: string[]
}

export interface PlatformAdapter {
  /** 平台元信息 */
  readonly meta: PlatformMeta

  /** 预处理配置 (Content Script 根据此配置预处理内容) */
  readonly preprocessConfig?: Partial<PreprocessConfig>

  /** 初始化适配器 */
  init(runtime: RuntimeInterface): Promise<void>

  /** 检查认证状态 */
  checkAuth(): Promise<AuthResult>

  /** 发布文章 */
  publish(article: Article, options?: PublishOptions): Promise<SyncResult>

  /** 上传图片 (如果支持) */
  uploadImage?(file: Blob, filename?: string): Promise<string>

  /** 获取分类列表 (如果支持) */
  getCategories?(): Promise<Category[]>

  /** 获取草稿列表 (如果支持) */
  getDrafts?(): Promise<Draft[]>

  /** 更新文章 (如果支持) */
  update?(postId: string, article: Article): Promise<SyncResult>

  /** 删除文章 (如果支持) */
  delete?(postId: string): Promise<void>

  /**
   * 发布一篇已存在的草稿（可选，对应 capabilities 里的 publish_existing_draft）
   *
   * 只在「创建草稿」和「发布草稿」是两个独立接口的平台实现。
   * 未实现的平台由调用方提示用户去后台手动发布，不会静默新建一篇。
   */
  publishExistingDraft?(ref: DraftRef): Promise<SyncResult>

  /** 自检信息（页面驱动类平台实现，用于诊断面板） */
  getDiagnostics?(): AdapterDiagnostics
}

/**
 * 分类
 */
export interface Category {
  id: string
  name: string
  parentId?: string
}

/**
 * 草稿
 */
export interface Draft {
  id: string
  title: string
  updatedAt: number
}

/**
 * 适配器注册项
 */
export interface AdapterRegistryEntry {
  meta: PlatformMeta
  factory: (runtime: RuntimeInterface) => PlatformAdapter
  /** 预处理配置 (Content Script 根据此配置预处理内容) */
  preprocessConfig?: Partial<PreprocessConfig>
}

/**
 * 适配器系统初始化
 */
import { adapterRegistry } from '@ugaeo/core'
import { createExtensionRuntime } from '../runtime/extension'
import { createLogger } from '../lib/logger'
import {
  trackSyncStart,
  trackPlatformSync,
  trackSyncComplete,
  inferErrorType,
  trackPlatformCombination,
  trackUsageTime,
  updateCumulativeStats,
  trackMilestone,
  trackAuthCheck,
} from '../lib/analytics'

// 导入代码适配器清单 - 唯一真源在 core，扩展只负责注册
import {
  BUILT_IN_ADAPTERS,
  type AdapterConstructor,
  type AuthCheckOptions,
  type PlatformAdapter,
  type PlatformMeta,
  type Article,
  type SyncResult,
} from '@ugaeo/core'

// 私有适配器 - private/ 目录通过 git submodule 管理
const privateModules = import.meta.glob<Record<string, unknown>>(
  '@ugaeo/core/adapters/platforms/private/*.ts',
  { eager: true }
)

// 从 glob 结果中提取适配器类
function getPrivateAdapters(): AdapterConstructor[] {
  const adapters: AdapterConstructor[] = []
  for (const mod of Object.values(privateModules)) {
    for (const [name, exported] of Object.entries(mod as Record<string, unknown>)) {
      // 检查是否是类（函数）且名称以 Adapter 结尾
      if (typeof exported === 'function' && name.endsWith('Adapter')) {
        try {
          // 尝试实例化检查是否有 meta 属性
          const instance = new (exported as AdapterConstructor)()
          if (instance && (instance as unknown as { meta?: unknown }).meta) {
            adapters.push(exported as AdapterConstructor)
          }
        } catch {
          // 实例化失败，跳过（文件可能不存在或格式不对）
        }
      }
    }
  }
  return adapters
}

// 所有适配器类列表：内置（core）+ 私有（submodule）
const ADAPTER_CLASSES: AdapterConstructor[] = [
  ...BUILT_IN_ADAPTERS,
  ...getPrivateAdapters(),
]

// 适配器注册条目 (类型安全)
interface AdapterEntry {
  meta: PlatformMeta
  factory: () => PlatformAdapter
  preprocessConfig?: Record<string, unknown>
}

// 生成适配器注册条目（包含 preprocessConfig）
const adapterEntries: AdapterEntry[] = ADAPTER_CLASSES.map(AdapterClass => {
  const instance = new AdapterClass()
  return {
    meta: instance.meta,
    factory: () => new AdapterClass(),
    preprocessConfig: (instance as unknown as { preprocessConfig?: Record<string, unknown> }).preprocessConfig,
  }
})

const logger = createLogger('UGAEO')

// 运行时实例
const runtime = createExtensionRuntime()

// 是否已初始化
let initialized = false

/**
 * 初始化适配器系统
 */
export async function initAdapters(): Promise<void> {
  if (initialized) return

  // 设置运行时
  adapterRegistry.setRuntime(runtime)

  // 注册所有适配器
  for (const entry of adapterEntries) {
    try {
      adapterRegistry.register(entry)
    } catch (error) {
      logger.error('Failed to register adapter:', error)
    }
  }

  initialized = true
}

/**
 * 获取适配器
 */
export async function getAdapter(platformId: string): Promise<PlatformAdapter | null> {
  await initAdapters()
  return adapterRegistry.get(platformId)
}

/**
 * 获取所有平台元信息
 */
export function getAllPlatformMetas() {
  return adapterRegistry.getAllMeta()
}

/**
 * 获取平台的预处理配置
 */
export function getPlatformPreprocessConfig(platformId: string) {
  return adapterRegistry.getPreprocessConfig(platformId)
}

/**
 * 获取多个平台的预处理配置
 */
export function getPlatformPreprocessConfigs(platformIds: string[]) {
  return adapterRegistry.getPreprocessConfigs(platformIds)
}

// 缓存配置
// v5：2.8.5 起注入脚本不再「一进来就判登录页」，企鹅号也加了页面实测，
// 旧缓存里存的是误判出来的「已登录 / 未登录」，key 升版让它们立即失效，
// 否则用户要等 5 分钟 TTL 才看到新结论（简书/企鹅号就是这么来回折腾的）。
const AUTH_CACHE_KEY = 'authCache:v5'
const AUTH_CACHE_TTL_AUTHENTICATED = 5 * 60 * 1000 // 已登录：5 分钟缓存
const AUTH_CACHE_TTL_UNAUTHENTICATED = 30 * 1000 // 未登录：30 秒缓存（用户可能随时登录）
const AUTH_CHECK_CONCURRENCY = 8 // 并行检查数量（平台 32 个，5 会让首轮检测明显偏慢）
const AUTH_CHECK_TIMEOUT = 10 * 1000 // 单个平台认证检查超时：10 秒
const PUBLISH_TIMEOUT = 10 * 60 * 1000 // 单个平台发布超时：10 分钟（包含图片上传）

/**
 * 带超时的 Promise 包装
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage))
    }, ms)

    promise
      .then(result => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/**
 * 把某个平台的登录态缓存标记为「已失效」
 *
 * 页面实测发现被踢回登录页时调用：缓存里的「已登录」是过期结论，
 * 不立刻改掉的话，用户看到的是「已登录」但每次同步都失败。
 */
async function markAuthExpired(platformId: string): Promise<void> {
  try {
    const cache = await getCachedAuth()
    cache[platformId] = {
      isAuthenticated: false,
      error: '登录态已失效，请重新登录',
      timestamp: Date.now(),
    }
    await setCachedAuth(cache)
  } catch {
    // 缓存写失败不影响本次同步结果
  }
}

/**
 * 检查平台登录状态
 *
 * 单个平台是「用户明确要看」的动作（点重新检测 / 自检 / 发布前确认），
 * 默认允许开页实测；调用方传 `probe: false` 才关掉。
 */
export async function checkPlatformAuth(platformId: string, options: AuthCheckOptions = { probe: true }) {
  const adapter = await getAdapter(platformId)
  if (!adapter) {
    return { isAuthenticated: false, error: 'Platform not found' }
  }
  try {
    return await withTimeout(
      adapter.checkAuth(options),
      AUTH_CHECK_TIMEOUT,
      `认证检查超时（${AUTH_CHECK_TIMEOUT / 1000}秒）`
    )
  } catch (error) {
    return { isAuthenticated: false, error: (error as Error).message }
  }
}

interface AuthCacheItem {
  isAuthenticated: boolean
  username?: string
  error?: string
  /** 'public' = 无需登录（公开投稿表单），界面要显示「无需登录」而不是「已登录」 */
  authMode?: 'cookie' | 'public'
  timestamp: number
}

interface AuthCache {
  [platformId: string]: AuthCacheItem
}

/**
 * 获取缓存的认证状态
 */
async function getCachedAuth(): Promise<AuthCache> {
  try {
    const storage = await chrome.storage.local.get(AUTH_CACHE_KEY)
    return storage[AUTH_CACHE_KEY] || {}
  } catch {
    return {}
  }
}

/**
 * 保存认证状态到缓存
 */
async function setCachedAuth(cache: AuthCache): Promise<void> {
  await chrome.storage.local.set({ [AUTH_CACHE_KEY]: cache })
}

/**
 * 清除认证缓存
 */
export async function clearAuthCache(): Promise<void> {
  await chrome.storage.local.remove(AUTH_CACHE_KEY)
}

/**
 * 检查所有平台登录状态（带缓存，并行检查）
 *
 * 批量检查默认 **不开页实测**：调用它的都是列表渲染（控制台 / popup / 浏览器启动预检），
 * 一开页用户就会看到八方资源网、企鹅号这些标签页自己弹出来又关掉。
 * 需要真结论的单个平台走 checkPlatformAuth。
 */
export async function checkAllPlatformsAuth(
  forceRefresh = false,
  options: AuthCheckOptions = { probe: false }
) {
  await initAdapters()

  const metas = adapterRegistry.getAllMeta()
  const cache = await getCachedAuth()
  const now = Date.now()
  const results: Array<
    PlatformMeta & {
      isAuthenticated: boolean
      username?: string
      error?: string
      authMode?: 'cookie' | 'public'
      needsProbe?: boolean
    }
  > = []
  const needsCheck: PlatformMeta[] = [] // 需要实际检查的平台

  logger.debug(' Checking auth for platforms:', metas.map(m => m.id), forceRefresh ? '(force refresh)' : '')

  // 第一步：分离缓存命中和需要检查的平台
  for (const meta of metas) {
    const cached = cache[meta.id]
    const cacheTTL = cached?.isAuthenticated ? AUTH_CACHE_TTL_AUTHENTICATED : AUTH_CACHE_TTL_UNAUTHENTICATED
    const cacheValid = cached && (now - cached.timestamp < cacheTTL) && !forceRefresh

    if (cacheValid) {
      logger.debug(` Using cached auth for ${meta.id} (TTL: ${cacheTTL / 1000}s)`)
      results.push({
        ...meta,
        isAuthenticated: cached.isAuthenticated,
        username: cached.username,
        error: cached.error,
        authMode: cached.authMode,
      })
    } else {
      needsCheck.push(meta)
    }
  }

  // 第二步：并行检查需要刷新的平台（分批，每批 AUTH_CHECK_CONCURRENCY 个）
  if (needsCheck.length > 0) {
    logger.debug(` Need to check ${needsCheck.length} platforms in parallel`)

    for (let i = 0; i < needsCheck.length; i += AUTH_CHECK_CONCURRENCY) {
      const batch = needsCheck.slice(i, i + AUTH_CHECK_CONCURRENCY)
      const batchResults = await Promise.all(batch.map(async (meta) => {
        try {
          const adapter = await adapterRegistry.get(meta.id)
          if (adapter) {
            logger.debug(` Checking auth for ${meta.id}...`)
            const auth = await withTimeout(
              adapter.checkAuth({ probe: options.probe === true }),
              AUTH_CHECK_TIMEOUT,
              `认证检查超时（${AUTH_CHECK_TIMEOUT / 1000}秒）`
            )
            logger.debug(` ${meta.id} auth result:`, auth)

            // 追踪认证检查
            trackAuthCheck(meta.id, auth.isAuthenticated).catch(() => {})

            // 「待检测」不是结论，不写缓存：下一次显式检测要拿到真结果，
            // 不能让它被一条假的「未登录」挡住 30 秒
            if (!auth.needsProbe) {
              cache[meta.id] = {
                isAuthenticated: auth.isAuthenticated,
                username: auth.username,
                error: auth.error,
                authMode: auth.authMode,
                timestamp: now,
              }
            }

            return {
              ...meta,
              isAuthenticated: auth.isAuthenticated,
              username: auth.username,
              error: auth.error,
              authMode: auth.authMode,
              needsProbe: auth.needsProbe,
            }
          }
          return { ...meta, isAuthenticated: false, error: 'Adapter not found' }
        } catch (error) {
          // 认证检查失败（未登录 / 超时）是常态，不是程序故障。
          // 这里用 warn：console.error 会被 Chrome 记成扩展错误，用户会在
          // chrome://extensions 看到一个吓人的「错误」按钮。
          logger.warn(`${meta.id} auth check failed:`, (error as Error).message)

          // 缓存错误状态
          cache[meta.id] = {
            isAuthenticated: false,
            error: (error as Error).message,
            timestamp: now,
          }

          return {
            ...meta,
            isAuthenticated: false,
            error: (error as Error).message,
          }
        }
      }))
      results.push(...batchResults)
    }
  }

  // 保存更新后的缓存
  await setCachedAuth(cache)

  // 追踪首次平台登录里程碑
  const hasLoggedIn = results.some(r => r.isAuthenticated)
  if (hasLoggedIn) {
    trackMilestone('first_platform_login').catch(() => {})
  }

  return results
}

/**
 * 图片进度回调类型
 */
export type ImageProgressCallback = (platform: string, current: number, total: number) => void

/**
 * 同步阶段类型
 */
export type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

/**
 * 详细同步进度类型
 */
export interface SyncDetailProgress {
  platform: string
  platformName: string
  stage: SyncStage
  // 图片上传进度（uploading_images 阶段）
  imageProgress?: { current: number; total: number }
  // 同步结果（completed/failed 阶段）
  result?: SyncResult
  // 错误信息（failed 阶段）
  error?: string
}

/**
 * 同步进度回调类型
 */
export interface SyncCallbacks {
  onResult?: (result: SyncResult) => void
  onImageProgress?: ImageProgressCallback
  // 新增：详细进度回调
  onDetailProgress?: (progress: SyncDetailProgress) => void
}

/**
 * 同步文章到平台
 */
export async function syncToPlatform(
  platformId: string,
  article: Article,
  options?: { draftOnly?: boolean },
  onImageProgress?: ImageProgressCallback
): Promise<SyncResult> {
  const adapter = await getAdapter(platformId)
  if (!adapter) {
    return {
      platform: platformId,
      success: false,
      error: 'Platform not found',
      timestamp: Date.now(),
    }
  }

  try {
    // 使用平台特定的预处理内容（如果有）
    let platformArticle = article
    const platformContents = (article as any).platformContents as Record<string, { html: string; markdown: string }> | undefined
    if (platformContents?.[platformId]) {
      const content = platformContents[platformId]
      platformArticle = {
        ...article,
        html: content.html,
        markdown: content.markdown,
      }
    }

    // 默认只保存草稿，带超时保护
    const result = await withTimeout(
      adapter.publish(platformArticle, {
        draftOnly: options?.draftOnly ?? true,
        onImageProgress: onImageProgress
          ? (current: number, total: number) => onImageProgress(platformId, current, total)
          : undefined,
      }),
      PUBLISH_TIMEOUT,
      `发布超时（${PUBLISH_TIMEOUT / 60000}分钟）`
    )

    // 平台不支持公开发布时统一标注，避免 UI 误显示为「已发布」
    //
    // 例外：AI 自动发布层的平台本来就没有 publish 能力，但页面驱动可能真的点到了
    // 「发布笔记 / 提交」并按 published 返回（draftOnly === false）。这时不能把它改回草稿，
    // 否则用户发了却被显示成「只存了草稿」。
    const supportsPublish = adapter.meta.capabilities?.includes('publish')
    if (options?.draftOnly === false && result.success && !supportsPublish && result.draftOnly !== false) {
      result.draftOnly = true
      result.message = result.message || '该平台没有直发接口，已把内容留在编辑器 / 草稿里'
    }

    return result
  } catch (error) {
    return {
      platform: platformId,
      success: false,
      error: (error as Error).message,
      timestamp: Date.now(),
    }
  }
}

// 并发数量限制
const CONCURRENCY_LIMIT = 3

// 同步取消控制
let syncAbortController: AbortController | null = null

/**
 * 取消正在进行的同步
 */
export function cancelSync(): boolean {
  if (syncAbortController) {
    syncAbortController.abort()
    syncAbortController = null
    return true
  }
  return false
}

/**
 * 检查同步是否正在进行
 */
export function isSyncing(): boolean {
  return syncAbortController !== null
}

/**
 * 同步文章到多个平台（并行，最多同时 3 个，支持取消）
 */
export async function syncToMultiplePlatforms(
  platformIds: string[],
  article: Article,
  callbacks?: SyncCallbacks,
  source = 'popup', // 来源：popup, weixin, weixin-editor, mcp 等
  options?: { draftOnlyByPlatform?: Record<string, boolean> }
): Promise<SyncResult[]> {
  // 创建新的取消控制器
  syncAbortController = new AbortController()
  const signal = syncAbortController.signal

  const results: SyncResult[] = []
  const startTime = Date.now()

  // 追踪同步开始
  trackSyncStart(source, platformIds).catch(() => {})

  // 追踪使用时段
  trackUsageTime().catch(() => {})

  // 追踪平台组合
  trackPlatformCombination(platformIds).catch(() => {})

  // 追踪首次同步尝试里程碑
  trackMilestone('first_sync_attempt').catch(() => {})

  // 获取平台名称的辅助函数
  const getPlatformName = (platformId: string): string => {
    const meta = getAllPlatformMetas().find(p => p.id === platformId)
    return meta?.name || platformId
  }

  // 同步单个平台并追踪
  const syncOne = async (platformId: string): Promise<SyncResult> => {
    const platformName = getPlatformName(platformId)

    // 检查是否已取消
    if (signal.aborted) {
      const cancelledResult: SyncResult = {
        platform: platformId,
        success: false,
        error: '已取消',
        timestamp: Date.now(),
      }
      callbacks?.onDetailProgress?.({
        platform: platformId,
        platformName,
        stage: 'failed',
        result: cancelledResult,
        error: '已取消',
      })
      return cancelledResult
    }

    // 通知开始同步
    callbacks?.onDetailProgress?.({
      platform: platformId,
      platformName,
      stage: 'starting',
    })

    const platformStartTime = Date.now()

    // 包装图片进度回调，同时触发 onDetailProgress
    const wrappedImageProgress: ImageProgressCallback | undefined = callbacks?.onImageProgress || callbacks?.onDetailProgress
      ? (platform, current, total) => {
          callbacks?.onImageProgress?.(platform, current, total)
          callbacks?.onDetailProgress?.({
            platform: platformId,
            platformName,
            stage: 'uploading_images',
            imageProgress: { current, total },
          })
          // 图片上传完成后，切换到 saving 阶段
          if (current === total && total > 0) {
            callbacks?.onDetailProgress?.({
              platform: platformId,
              platformName,
              stage: 'saving',
            })
          }
        }
      : undefined

    // 平台专属标题：规则适配 / AI 改写算出来的，只在这一条链路上覆盖
    const overrideTitle = article.platformTitles?.[platformId]

    // AI 发布计划：该平台的摘要与标签（发布模式才会生成）
    const brief = article.platformBriefs?.[platformId]
    const articleForPlatform: Article = brief
      ? {
          ...article,
          ...(overrideTitle ? { title: overrideTitle } : {}),
          summary: brief.summary || article.summary,
          tags: brief.tags.length ? brief.tags : article.tags,
        }
      : overrideTitle
        ? { ...article, title: overrideTitle }
        : article

    const result = await syncToPlatform(
      platformId,
      articleForPlatform,
      { draftOnly: options?.draftOnlyByPlatform?.[platformId] ?? true },
      wrappedImageProgress
    )

    // 登录态在页面实测里被判定失效：把缓存里的「已登录」改掉，
    // 否则界面会一直显示已登录、用户反复点同步（简书 / 企鹅号就是这么折腾的）
    if (result.authExpired) {
      await markAuthExpired(platformId)
    }

    if (overrideTitle && overrideTitle !== article.title) {
      result.titleNote = `标题按规则改为「${overrideTitle}」`
    }

    // 通知完成/失败
    callbacks?.onDetailProgress?.({
      platform: platformId,
      platformName,
      stage: result.success ? 'completed' : 'failed',
      result,
      error: result.error,
    })

    callbacks?.onResult?.(result)

    // 追踪单个平台同步结果
    const platformDuration = Date.now() - platformStartTime
    trackPlatformSync(source, platformId, result.success, {
      draftOnly: result.draftOnly,
      errorType: result.error ? inferErrorType(result.error) : undefined,
      duration: platformDuration,
    }).catch(() => {})

    return result
  }

  // 分批并行执行（每批最多 CONCURRENCY_LIMIT 个）
  for (let i = 0; i < platformIds.length; i += CONCURRENCY_LIMIT) {
    // 每批前检查是否取消
    if (signal.aborted) {
      // 剩余平台标记为已取消
      const remaining = platformIds.slice(i)
      for (const platformId of remaining) {
        const cancelledResult: SyncResult = {
          platform: platformId,
          success: false,
          error: '已取消',
          timestamp: Date.now(),
        }
        results.push(cancelledResult)
        callbacks?.onResult?.(cancelledResult)
      }
      break
    }

    const batch = platformIds.slice(i, i + CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map(syncOne))
    results.push(...batchResults)
  }

  // 清除控制器
  syncAbortController = null

  // 追踪同步完成
  const successCount = results.filter(r => r.success).length
  const cancelledCount = results.filter(r => r.error === '已取消').length
  trackSyncComplete({
    source,
    total: results.length,
    success: successCount,
    failed: results.length - successCount - cancelledCount,
    platforms: platformIds,
    duration: Date.now() - startTime,
  }).catch(() => {})

  // 追踪首次同步成功里程碑
  if (successCount > 0) {
    trackMilestone('first_sync_success').catch(() => {})
  }

  // 更新累计统计（会自动触发里程碑检查）
  updateCumulativeStats(platformIds).catch(() => {})

  return results
}

import { create } from 'zustand'
import { getPublishSettings } from '../../lib/publish-settings'
import { extractArticleFromTab, describeExtractFailure } from '../../lib/tab-extractor'
import { describeCaptureResult, isCaptureActive, type FeishuCaptureState } from '../../lib/feishu-capture'
import { planTitleAdaptation, type TitlePlan } from '../../lib/title-strategy'
import { planPublishBriefs, type BriefPlan } from '../../lib/publish-brief'
import {
  buildDraftRefs,
  buildDraftOnlyMap,
  defaultScheduleValue,
  canAutoPublish,
  draftPublishMode,
  isScheduleValid,
  parseDateTimeLocal,
} from './publish-flow'
import type {
  Article,
  ArticleSnapshot,
  CmsAccount,
  DraftRef,
  FailureItem,
  HistoryItem,
  Notice,
  Platform,
  PlatformProgress,
  SyncResult,
} from './types'

const SELECTED_PLATFORMS_KEY = 'selectedPlatforms'
/** 带入发布页的草稿，刷新控制台后不丢 */
const PENDING_DRAFTS_KEY = 'pendingDraftRefs'
/**
 * 待同步文章本体
 *
 * 以前只存在内存里，刷新控制台就没了；右键菜单提取、手动新建、边改边存
 * 都需要它活过页面刷新，所以落一份到 storage.local。
 */
export const PENDING_ARTICLE_KEY = 'pendingArticle'
/** 飞书捕获状态（后台写、控制台读） */
const FEISHU_CAPTURE_KEY = 'feishuCapture'
const HANDOFF_KEY = 'consoleHandoff'
const HANDOFF_TTL = 30 * 60 * 1000

export type PublishTiming = 'now' | 'schedule'

/** 定时队列里的一条任务（只保留界面要展示的字段） */
export interface ScheduledJobInfo {
  id: string
  title: string
  publishAt: number
  platforms: string[]
  kind?: 'sync' | 'publish-drafts'
}

interface SyncState {
  running: boolean
  syncId: string | null
  results: SyncResult[]
  stages: Record<string, PlatformProgress>
  error: string | null
}

interface ConsoleState {
  booted: boolean
  loadingPlatforms: boolean
  checkingAll: boolean
  checkingId: string | null
  lastCheckedAt: number | null

  platforms: Platform[]
  cmsAccounts: CmsAccount[]
  history: HistoryItem[]
  snapshots: Record<string, ArticleSnapshot>

  article: Article | null
  selectedPlatforms: string[]
  publishMode: 'draft' | 'publish'
  /** 发布时间：立即 / 定时（只在 publish 模式生效） */
  publishTiming: PublishTiming
  /** 定时时间，datetime-local 字符串 */
  scheduledAt: string
  /** 上一次草稿同步带过来的草稿，发布页直接用 */
  draftRefs: DraftRef[]
  /** 勾选要发布的草稿（按平台 id） */
  selectedDraftRefs: string[]
  /** 已排队的定时任务 */
  scheduledJobs: ScheduledJobInfo[]
  /** 最近一次执行的是哪类动作，决定结果列表显示在哪个页签 */
  lastRunKind: 'draft' | 'publish' | 'publish-drafts' | null
  sync: SyncState
  notice: Notice | null

  boot: () => Promise<void>
  refreshPlatforms: (force?: boolean) => Promise<void>
  recheckOne: (platformId: string) => Promise<void>
  openPlatform: (platform: { homepage: string }) => void

  setArticle: (article: Article | null) => void
  extractFromActiveTab: () => Promise<boolean>
  /** 飞书捕获：点按钮 → 打开云文档 → 用户在飞书里打开文档后自动提取 */
  feishuCapture: FeishuCaptureState
  startFeishuCapture: () => Promise<void>
  cancelFeishuCapture: () => Promise<void>
  loadSnapshot: (syncId: string) => Promise<ArticleSnapshot | null>

  togglePlatform: (platformId: string) => void
  setSelected: (ids: string[]) => void
  selectAll: () => void
  deselectAll: () => void
  setPublishMode: (mode: 'draft' | 'publish') => void
  setPublishTiming: (timing: PublishTiming) => void
  setScheduledAt: (value: string) => void
  toggleDraftRef: (platformId: string) => void
  /** 把本次草稿同步的结果带入发布页 */
  carryDrafts: (platformIds?: string[]) => void
  clearDraftRefs: () => void
  publishSelectedDrafts: () => Promise<void>
  refreshScheduledJobs: () => Promise<void>

  startSync: () => Promise<void>
  runSync: (
    article: Article,
    platformIds: string[],
    options?: { syncId?: string; mode?: 'draft' | 'publish'; timing?: PublishTiming; publishAt?: number }
  ) => Promise<SyncResult[]>

  refreshHistory: () => Promise<void>
  deleteCmsAccount: (id: string) => Promise<void>
  testCmsConnection: (id: string) => Promise<{ success: boolean; message?: string }>

  setNotice: (notice: Notice | null) => void
}

async function saveSelectedPlatforms(ids: string[]) {
  try {
    await chrome.storage.local.set({ [SELECTED_PLATFORMS_KEY]: ids })
  } catch {
    // storage 失败不影响当前会话
  }
}

function newSyncId() {
  return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/** 提交一个定时任务给后台（同步文章 / 发布草稿都走这里） */
async function requestScheduledJob(payload: Record<string, unknown>): Promise<{
  ok: boolean
  error?: string
  data?: ScheduledJobInfo
}> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SCHEDULE_CREATE', payload })
    if (!response) return { ok: false, error: '后台没有响应' }
    return { ok: !!response.ok, error: response.error, data: response.data as ScheduledJobInfo }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

function formatMoment(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  booted: false,
  loadingPlatforms: false,
  checkingAll: false,
  checkingId: null,
  lastCheckedAt: null,

  platforms: [],
  cmsAccounts: [],
  history: [],
  snapshots: {},

  article: null,
  selectedPlatforms: [],
  publishMode: 'draft',
  publishTiming: 'now',
  scheduledAt: '',
  draftRefs: [],
  selectedDraftRefs: [],
  scheduledJobs: [],
  lastRunKind: null,
  sync: { running: false, syncId: null, results: [], stages: {}, error: null },
  notice: null,
  feishuCapture: { status: 'idle' },

  boot: async () => {
    if (get().booted) return

    // 1. 先用缓存把界面点亮
    try {
      const cached = await chrome.storage.local.get(['platformListCache', 'cmsAccounts', 'syncHistory', 'articleSnapshots'])
      if (cached.platformListCache?.length) {
        set({ platforms: cached.platformListCache as Platform[] })
      }
      set({
        cmsAccounts: (cached.cmsAccounts || []) as CmsAccount[],
        history: (cached.syncHistory || []) as HistoryItem[],
        snapshots: (cached.articleSnapshots || {}) as Record<string, ArticleSnapshot>,
      })
    } catch {
      // ignore
    }

    // 2. 同步交接的数据（popup 点「同步」时写入）
    try {
      const handoff = await chrome.storage.local.get(HANDOFF_KEY)
      const payload = handoff[HANDOFF_KEY] as
        | { article?: Article; platformIds?: string[]; createdAt?: number }
        | undefined
      if (payload?.article && Date.now() - (payload.createdAt || 0) < HANDOFF_TTL) {
        set({
          article: payload.article,
          selectedPlatforms: Array.isArray(payload.platformIds) ? payload.platformIds : [],
        })
        await chrome.storage.local.remove(HANDOFF_KEY)
      } else {
        await chrome.storage.local.remove(HANDOFF_KEY)
      }
    } catch {
      // ignore
    }

    // 2.5 上次没发完 / 刚存下的待同步文章（右键提取、手动新建都写这里）
    try {
      const stored = await chrome.storage.local.get([PENDING_ARTICLE_KEY, 'pendingArticleError'])
      const pendingArticle = stored[PENDING_ARTICLE_KEY] as Article | undefined
      if (pendingArticle && !get().article) {
        set({ article: pendingArticle })
      }
      // 右键提取失败的原因，带过来给用户看（否则只会看到一个空页面）
      const extractError = stored.pendingArticleError as string | undefined
      if (extractError) {
        set({ notice: { kind: 'error', text: extractError } })
        await chrome.storage.local.remove('pendingArticleError')
      }
    } catch {
      // ignore
    }

    // 2.6 飞书捕获状态：后台抽完文档会 reload 本页，这里把结果/等待态读回来
    try {
      const stored = await chrome.storage.local.get(FEISHU_CAPTURE_KEY)
      const capture = stored[FEISHU_CAPTURE_KEY] as FeishuCaptureState | undefined
      if (capture && capture.status !== 'idle') {
        set({ feishuCapture: capture })
        if (capture.status === 'waiting' && !isCaptureActive(capture)) {
          set({ feishuCapture: { status: 'idle' } })
        }
        if (capture.status === 'done') {
          set({
            notice: {
              kind: 'ok',
              text: describeCaptureResult(capture.title, capture.images),
            },
          })
        }
        if (capture.status === 'failed') {
          set({ notice: { kind: 'error', text: capture.error } })
        }
      }
    } catch {
      // ignore
    }

    // 3. 发布设置 + 选中的平台
    try {
      const settings = await getPublishSettings()
      set({
        publishMode: settings.mode === 'draft' ? 'draft' : 'publish',
        scheduledAt: get().scheduledAt || defaultScheduleValue(),
      })
      const saved = await chrome.storage.local.get([SELECTED_PLATFORMS_KEY, PENDING_DRAFTS_KEY])
      if (Array.isArray(saved[SELECTED_PLATFORMS_KEY]) && !get().selectedPlatforms.length) {
        set({ selectedPlatforms: saved[SELECTED_PLATFORMS_KEY] as string[] })
      }

      const pending = saved[PENDING_DRAFTS_KEY] as DraftRef[] | undefined
      if (Array.isArray(pending) && pending.length) {
        set({ draftRefs: pending, selectedDraftRefs: pending.map(ref => ref.platform) })
      }
    } catch {
      // ignore
    }

    set({ booted: true })

    // 4. 实时刷新登录态（内部会更新 lastCheckedAt）
    get().refreshPlatforms(false).catch(() => {})
    get().refreshScheduledJobs().catch(() => {})
  },

  refreshPlatforms: async (force = false) => {
    if (force) set({ checkingAll: true })
    set({ loadingPlatforms: true })
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_ALL_AUTH',
        payload: { forceRefresh: force },
      })
      if (response?.error) throw new Error(response.error)

      const platforms: Platform[] = (response?.platforms || []) as Platform[]
      set({
        platforms,
        lastCheckedAt: Date.now(),
        cmsAccounts: ((await chrome.storage.local.get('cmsAccounts')).cmsAccounts || []) as CmsAccount[],
      })

      // 已登录集合变了，裁掉失效的选中项
      const authed = new Set(platforms.filter(p => p.isAuthenticated).map(p => p.id))
      const nextSelected = get().selectedPlatforms.filter(id => authed.has(id))
      if (nextSelected.length !== get().selectedPlatforms.length) {
        set({ selectedPlatforms: nextSelected })
        saveSelectedPlatforms(nextSelected)
      }
    } catch (error) {
      set({ notice: { kind: 'error', text: `登录状态检测失败：${(error as Error).message}` } })
    } finally {
      set({ loadingPlatforms: false, checkingAll: false })
    }
  },

  recheckOne: async (platformId) => {
    set({ checkingId: platformId })
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH', payload: { platformId } })
      const auth = response?.auth
      if (!auth) throw new Error('未返回检测结果')

      const platforms = get().platforms.map(p =>
        p.id === platformId
          ? {
              ...p,
              isAuthenticated: !!auth.isAuthenticated,
              authMode: auth.authMode ?? p.authMode,
              username: auth.username || p.username,
              // 已登录也保留备注（如「主站已登录但未开通财富号」），便于排查
              error: auth.error,
            }
          : p
      )
      set({ platforms })
      set({
        notice: {
          kind: auth.isAuthenticated ? 'ok' : 'info',
          text: auth.isAuthenticated
            ? auth.authMode === 'public'
              ? `${platforms.find(p => p.id === platformId)?.name || platformId} 无需登录（公开投稿入口，可直接使用）`
              : `${platforms.find(p => p.id === platformId)?.name || platformId} 已登录${auth.username ? `（${auth.username}）` : ''}`
            : `${platforms.find(p => p.id === platformId)?.name || platformId} 未检测到登录态${auth.error ? `：${auth.error}` : ''}`,
        },
      })

      // 同步更新缓存，popup 打开时也用最新结果
      chrome.storage.local.set({ platformListCache: platforms }).catch(() => {})
    } catch (error) {
      set({ notice: { kind: 'error', text: `检测失败：${(error as Error).message}` } })
    } finally {
      set({ checkingId: null })
    }
  },

  openPlatform: (platform) => {
    if (!platform.homepage) return
    chrome.tabs.create({ url: platform.homepage }).catch(() => {})
  },

  setArticle: (article) => {
    set({ article })
    // 落盘：控制台刷新、切换页签后内容都还在
    if (article) {
      chrome.storage.local.set({ [PENDING_ARTICLE_KEY]: article }).catch(() => {})
    } else {
      chrome.storage.local.remove(PENDING_ARTICLE_KEY).catch(() => {})
    }
  },

  extractFromActiveTab: async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) throw new Error('没有可用的标签页')

      const { article, reason } = await extractArticleFromTab<Article>(tab.id, tab.url)
      if (!article) {
        set({ notice: { kind: 'error', text: describeExtractFailure(reason) } })
        return false
      }

      set({ article })
      chrome.storage.local.set({ [PENDING_ARTICLE_KEY]: article }).catch(() => {})
      return true
    } catch (error) {
      set({ notice: { kind: 'error', text: `提取失败：${(error as Error).message}` } })
      return false
    }
  },

  startFeishuCapture: async () => {
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'START_FEISHU_CAPTURE' })) as
        | { homeUrl?: string; until?: number; error?: string }
        | undefined
      if (result?.error) throw new Error(result.error)

      set({
        feishuCapture: {
          status: 'waiting',
          until: result?.until || Date.now() + 30 * 60 * 1000,
          homeUrl: result?.homeUrl || '',
        },
        notice: {
          kind: 'info',
          text: '已在飞书打开云文档：在飞书里打开任意文档，正文会自动提取到「待同步文章」',
        },
      })
    } catch (error) {
      set({ notice: { kind: 'error', text: `打开飞书失败：${(error as Error).message}` } })
    }
  },

  cancelFeishuCapture: async () => {
    set({ feishuCapture: { status: 'idle' } })
    try {
      await chrome.runtime.sendMessage({ type: 'CANCEL_FEISHU_CAPTURE' })
    } catch {
      // 后台没醒也没关系，状态窗口到点自然失效
    }
  },

  loadSnapshot: async (syncId) => {
    const local = get().snapshots[syncId]
    if (local) return local
    try {
      const storage = await chrome.storage.local.get('articleSnapshots')
      const snapshots = (storage.articleSnapshots || {}) as Record<string, ArticleSnapshot>
      set({ snapshots })
      return snapshots[syncId] || null
    } catch {
      return null
    }
  },

  togglePlatform: (platformId) => {
    const { selectedPlatforms } = get()
    const next = selectedPlatforms.includes(platformId)
      ? selectedPlatforms.filter(id => id !== platformId)
      : [...selectedPlatforms, platformId]
    set({ selectedPlatforms: next })
    saveSelectedPlatforms(next)
  },

  setSelected: (ids) => {
    set({ selectedPlatforms: ids })
    saveSelectedPlatforms(ids)
  },

  selectAll: () => {
    const ids = get().platforms.filter(p => p.isAuthenticated).map(p => p.id)
    set({ selectedPlatforms: ids })
    saveSelectedPlatforms(ids)
  },

  deselectAll: () => {
    set({ selectedPlatforms: [] })
    saveSelectedPlatforms([])
  },

  setPublishMode: (mode) =>
    set(state => {
      if (mode === 'publish') {
        // 草稿页是全量平台，切到发布页要把「未登录 / 词条平台」的从选中里摘掉：
        // 可直发 + AI 自动发布都在可发布范围内，词条平台没有编辑器，带着只会注定失败
        const allowed = new Set(
          state.platforms
            .filter(platform => platform.isAuthenticated && canAutoPublish(platform))
            .map(platform => platform.id)
        )
        return {
          publishMode: mode,
          selectedPlatforms: state.selectedPlatforms.filter(id => allowed.has(id)),
          // 切到发布页时如果没有定时时间，给一个默认值，省得用户每次都要点
          scheduledAt: state.scheduledAt || defaultScheduleValue(),
        }
      }
      return { publishMode: mode }
    }),

  setPublishTiming: (timing) =>
    set(state => ({
      publishTiming: timing,
      scheduledAt: timing === 'schedule' && !state.scheduledAt ? defaultScheduleValue() : state.scheduledAt,
    })),

  setScheduledAt: (value) => set({ scheduledAt: value }),

  toggleDraftRef: (platformId) =>
    set(state => ({
      selectedDraftRefs: state.selectedDraftRefs.includes(platformId)
        ? state.selectedDraftRefs.filter(id => id !== platformId)
        : [...state.selectedDraftRefs, platformId],
    })),

  carryDrafts: (platformIds) => {
    const { sync, platforms } = get()
    const picked = platformIds && platformIds.length ? new Set(platformIds) : null
    const refs = buildDraftRefs(sync.results, platforms).filter(ref => !picked || picked.has(ref.platform))
    if (!refs.length) {
      set({ notice: { kind: 'info', text: '本次没有成功保存的草稿，先同步一遍再试' } })
      return
    }

    const auto = refs
      .filter(ref => draftPublishMode(ref, platforms) === 'auto')
      .map(ref => ref.platform)

    set(state => ({
      draftRefs: refs,
      selectedDraftRefs: auto,
      publishMode: 'publish',
      publishTiming: 'now',
      scheduledAt: state.scheduledAt || defaultScheduleValue(),
    }))

    chrome.storage.local.set({ [PENDING_DRAFTS_KEY]: refs }).catch(() => {})

    set({
      notice: auto.length
        ? {
            kind: 'ok',
            text: `已带入 ${refs.length} 篇草稿，其中 ${auto.length} 篇可直接发布，其余需到平台后台点发布`,
          }
        : {
            kind: 'info',
            text: `已带入 ${refs.length} 篇草稿，但这些平台都不支持草稿转发布，请点「打开草稿」到后台发布`,
          },
    })
  },

  clearDraftRefs: () => {
    set({ draftRefs: [], selectedDraftRefs: [] })
    chrome.storage.local.remove(PENDING_DRAFTS_KEY).catch(() => {})
  },

  refreshScheduledJobs: async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SCHEDULE_LIST' })
      const jobs = (response?.data || []) as ScheduledJobInfo[]
      set({
        scheduledJobs: jobs.map(job => ({
          id: job.id,
          title: job.title,
          publishAt: job.publishAt,
          platforms: job.platforms || [],
          kind: job.kind,
        })),
      })
    } catch {
      // 定时列表拿不到不影响主流程
    }
  },

  startSync: async () => {
    const { article, selectedPlatforms, publishMode, publishTiming, scheduledAt } = get()

    if (!article) {
      set({ notice: { kind: 'error', text: '还没有待同步的文章' } })
      return
    }
    if (!selectedPlatforms.length) {
      set({ notice: { kind: 'error', text: '请先选择目标平台' } })
      return
    }

    // 发布 + 定时：只入队，不立即执行
    if (publishMode === 'publish' && publishTiming === 'schedule') {
      const publishAt = parseDateTimeLocal(scheduledAt)
      if (!isScheduleValid(publishAt)) {
        set({ notice: { kind: 'error', text: '请选择至少 1 分钟之后的定时时间' } })
        return
      }
      await get().runSync(article, selectedPlatforms, {
        mode: 'publish',
        timing: 'schedule',
        publishAt: publishAt!,
      })
      return
    }

    await get().runSync(article, selectedPlatforms, { mode: publishMode, timing: 'now' })
  },

  runSync: async (article, platformIds, options = {}) => {
    const syncId = options.syncId || newSyncId()
    const mode = options.mode || get().publishMode

    // 发布模式下只剔掉第三层「词条平台」：它们没有文章编辑器，注入进去也没有可点的发布按钮。
    // 可直发与 AI 自动发布（有编辑器、没有直发接口）都要跑 —— 后者由 AI 改好文案、
    // 脚本填表再点发布，点不到就老实退回草稿，而不是假装发出去。
    const metaById = new Map(get().platforms.map(platform => [platform.id, platform]))
    const targets =
      mode === 'publish'
        ? platformIds.filter(id => {
            const meta = metaById.get(id)
            return !meta || canAutoPublish(meta)
          })
        : platformIds

    if (!targets.length) {
      set({ notice: { kind: 'error', text: '所选平台都是词条平台（没有文章编辑器），请改用「存为草稿」' } })
      return []
    }

    // 控制台的两个页签是明确选择：草稿 = 全部存草稿，发布 = 全部尝试公开发布
    const draftOnlyByPlatform = buildDraftOnlyMap(mode, targets)

    // 按平台规则适配标题：超长的先按标点截断保底，AI 可用时再换个说法
    // 适配失败绝不阻断同步 —— 最差就是原样发出去，和以前一样
    let articleForSync = article
    let titlePlan: TitlePlan | null = null
    try {
      titlePlan = await planTitleAdaptation({
        title: article.title,
        bodyText: article.markdown || article.content || article.html || '',
        platforms: targets.map(id => ({ id, name: metaById.get(id)?.name || id })),
      })
      if (Object.keys(titlePlan.titles).length) {
        articleForSync = { ...article, platformTitles: titlePlan.titles }
      }
    } catch {
      // ignore
    }

    // 发布模式：让 AI 给每个平台写一份「怎么发」的计划（标题 / 摘要 / 标签）。
    // 草稿不调模型 —— 草稿是半成品，没必要为它花调用，也没必要把 AI 痕迹留在里面。
    let briefPlan: BriefPlan | null = null
    if (mode === 'publish') {
      try {
        briefPlan = await planPublishBriefs({
          title: article.title,
          bodyText: article.markdown || article.content || article.html || '',
          platforms: targets.map(id => ({ id, name: metaById.get(id)?.name || id })),
        })
        if (Object.keys(briefPlan.briefs).length) {
          articleForSync = {
            ...articleForSync,
            platformBriefs: briefPlan.briefs,
            // AI 的标题优先于规则截断：它是「换一种更短的说法」，不是硬切
            platformTitles: { ...(articleForSync.platformTitles || {}), ...briefPlan.titles },
          }
        }
      } catch {
        // AI 不可用不影响发布：退回规则标题 + 不填标签
      }
    }

    if (mode === 'publish' && options.timing === 'schedule' && options.publishAt) {
      const publishAt = options.publishAt
      const scheduled = await requestScheduledJob({
        article: articleForSync,
        platforms: targets,
        publishAt,
        draftOnlyByPlatform,
        kind: 'sync',
        title: articleForSync.title,
      })

      if (!scheduled.ok) {
        set({ notice: { kind: 'error', text: `加入定时队列失败：${scheduled.error || '未知原因'}` } })
        return []
      }

      set({
        notice: { kind: 'ok', text: `已加入定时队列，将于 ${formatMoment(publishAt)} 自动发布` },
      })
      get().refreshScheduledJobs().catch(() => {})
      return []
    }

    set({
      sync: { running: true, syncId, results: [], stages: {}, error: null },
      notice: null,
      lastRunKind: mode === 'draft' ? 'draft' : 'publish',
    })

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: {
          article: articleForSync,
          platforms: targets,
          syncId,
          draftOnlyByPlatform,
          source: 'console',
        },
      })

      const results: SyncResult[] = (response?.results || []) as SyncResult[]
      const failed = results.filter(r => !r.success).length
      const draftCount = results.filter(r => r.success && r.draftOnly !== false).length
      const publishedCount = results.filter(r => r.success && r.draftOnly === false).length

      const adjusted = titlePlan?.items.length || 0
      const aiBriefs = briefPlan?.usedAI || 0
      const summary =
        (mode === 'draft'
          ? `已存为草稿：${draftCount} 个平台${failed ? `，${failed} 个失败` : ''}`
          : `发布完成：${publishedCount} 个平台${draftCount ? `，${draftCount} 个仅存草稿` : ''}${failed ? `，${failed} 个失败` : ''}`) +
        (aiBriefs ? `；AI 已为 ${aiBriefs} 个平台生成标题/标签` : '') +
        (adjusted ? `；${adjusted} 个平台标题已按规则调整` : '') +
        (mode === 'publish' && briefPlan?.aiSkipReason ? `；${briefPlan.aiSkipReason}` : '')

      set(state => ({
        sync: { ...state.sync, running: false, results },
        notice: { kind: failed ? 'error' : 'ok', text: summary },
        // 草稿同步完成后默认勾选成功的那些，直接可以「下一步」
        selectedDraftRefs:
          mode === 'draft'
            ? results.filter(r => r.success && r.draftOnly !== false).map(r => r.platform)
            : state.selectedDraftRefs,
      }))

      if (response?.rateLimitWarning) {
        set({ notice: { kind: 'info', text: response.rateLimitWarning } })
      }

      get().refreshHistory().catch(() => {})
      return results
    } catch (error) {
      set(state => ({
        sync: { ...state.sync, running: false, error: (error as Error).message },
        notice: { kind: 'error', text: `同步失败：${(error as Error).message}` },
      }))
      return []
    }
  },

  publishSelectedDrafts: async () => {
    const { draftRefs, selectedDraftRefs, platforms, publishTiming, scheduledAt, article } = get()

    const picked = draftRefs.filter(
      ref => selectedDraftRefs.includes(ref.platform) && draftPublishMode(ref, platforms) === 'auto'
    )

    if (!picked.length) {
      const manualCount = draftRefs.filter(
        ref => selectedDraftRefs.includes(ref.platform) && draftPublishMode(ref, platforms) === 'manual'
      ).length
      set({
        notice: {
          kind: 'error',
          text: manualCount
            ? '选中的草稿只能到平台后台发布，点每行的「打开草稿」手动发一次'
            : '请先勾选要发布的草稿',
        },
      })
      return
    }

    if (publishTiming === 'schedule') {
      const publishAt = parseDateTimeLocal(scheduledAt)
      if (!isScheduleValid(publishAt)) {
        set({ notice: { kind: 'error', text: '请选择至少 1 分钟之后的定时时间' } })
        return
      }

      const scheduled = await requestScheduledJob({
        platforms: picked.map(ref => ref.platform),
        publishAt,
        kind: 'publish-drafts',
        draftRefs: picked,
        title: article?.title || picked[0]?.title || '草稿转发布',
      })

      if (!scheduled.ok) {
        set({ notice: { kind: 'error', text: `加入定时队列失败：${scheduled.error || '未知原因'}` } })
        return
      }

      set({
        notice: {
          kind: 'ok',
          text: `已加入定时队列：${picked.length} 篇草稿将于 ${formatMoment(publishAt!)} 发布`,
        },
      })
      get().refreshScheduledJobs().catch(() => {})
      return
    }

    const syncId = newSyncId()
    set({
      sync: { running: true, syncId, results: [], stages: {}, error: null },
      notice: null,
      lastRunKind: 'publish-drafts',
    })

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PUBLISH_DRAFTS',
        payload: { refs: picked, syncId },
      })

      const results: SyncResult[] = (response?.results || []) as SyncResult[]
      const okCount = results.filter(r => r.success).length
      const failed = results.length - okCount

      set(state => ({
        sync: { ...state.sync, running: false, results },
        notice: {
          kind: failed ? 'error' : 'ok',
          text: failed ? `草稿发布：${okCount} 篇成功，${failed} 篇失败` : `草稿发布：${okCount} 篇全部成功`,
        },
      }))

      // 已成功发布的草稿从待发布列表里移除，避免重复点
      const done = new Set(results.filter(r => r.success).map(r => r.platform))
      if (done.size) {
        const left = get().draftRefs.filter(ref => !done.has(ref.platform))
        set({
          draftRefs: left,
          selectedDraftRefs: get().selectedDraftRefs.filter(id => left.some(ref => ref.platform === id)),
        })
        if (left.length) chrome.storage.local.set({ [PENDING_DRAFTS_KEY]: left }).catch(() => {})
        else chrome.storage.local.remove(PENDING_DRAFTS_KEY).catch(() => {})
      }

      get().refreshHistory().catch(() => {})
    } catch (error) {
      set(state => ({
        sync: { ...state.sync, running: false, error: (error as Error).message },
        notice: { kind: 'error', text: `草稿发布失败：${(error as Error).message}` },
      }))
    }
  },

  refreshHistory: async () => {
    try {
      const [storage, snapshots] = await Promise.all([
        chrome.storage.local.get('syncHistory'),
        chrome.storage.local.get('articleSnapshots'),
      ])
      set({
        history: (storage.syncHistory || []) as HistoryItem[],
        snapshots: (snapshots.articleSnapshots || {}) as Record<string, ArticleSnapshot>,
      })
    } catch {
      // ignore
    }
  },

  deleteCmsAccount: async (id) => {
    try {
      const storage = await chrome.storage.local.get('cmsAccounts')
      const updated = ((storage.cmsAccounts || []) as CmsAccount[]).filter(a => a.id !== id)
      await chrome.storage.local.set({ cmsAccounts: updated })
      await chrome.storage.local.remove(`cms_pwd_${id}`)
      set({
        cmsAccounts: updated,
        platforms: get().platforms.filter(p => p.id !== id),
        selectedPlatforms: get().selectedPlatforms.filter(pid => pid !== id),
        notice: { kind: 'ok', text: '站点已删除' },
      })
    } catch (error) {
      set({ notice: { kind: 'error', text: `删除失败：${(error as Error).message}` } })
    }
  },

  testCmsConnection: async (id) => {
    try {
      const storage = await chrome.storage.local.get(['cmsAccounts', `cms_pwd_${id}`])
      const account = ((storage.cmsAccounts || []) as CmsAccount[]).find(a => a.id === id)
      if (!account) return { success: false, message: '账号不存在' }
      const password = storage[`cms_pwd_${id}`]
      if (!password) return { success: false, message: '本地未保存密码，请重新添加站点' }

      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CMS_CONNECTION',
        payload: { type: account.type, url: account.url, username: account.username, password },
      })
      return { success: !!response?.success, message: response?.message || response?.error }
    } catch (error) {
      return { success: false, message: (error as Error).message }
    }
  },

  setNotice: (notice) => set({ notice }),
}))

/**
 * 把同步历史里的失败结果拍平成「失败条目」，供失败处理页使用
 */
export function collectFailures(history: HistoryItem[], withinDays = 7): FailureItem[] {
  const since = Date.now() - withinDays * 24 * 60 * 60 * 1000
  const items: FailureItem[] = []

  for (const record of history) {
    const time = record.endTime || record.startTime
    if (time < since) continue
    for (const result of record.results || []) {
      const rejected = result.reviewStatus === 'rejected'
      if (result.success && !rejected) continue
      const error = result.error || (rejected ? result.reviewStatusText || '平台审核未通过' : '未知错误')
      items.push({
        syncId: record.id,
        title: record.title,
        platform: result.platform,
        platformName: result.platformName || result.platform,
        error,
        message: result.message,
        postUrl: result.postUrl,
        draftOnly: result.draftOnly,
        reviewStatus: result.reviewStatus,
        time,
        kind: /登录|认证|未授权|cookie|401|403/i.test(error) ? 'auth' : 'publish',
      })
    }
  }

  return items.sort((a, b) => b.time - a.time)
}

/**
 * 控制台已经打开时，popup 再点「同步」只会改 hash（页面不重新加载），
 * 所以这里监听交接数据的写入，实时接收新文章。
 */
let handoffBound = false
export function bindHandoffListener() {
  if (handoffBound) return
  handoffBound = true

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.consoleHandoff) return
    const payload = changes.consoleHandoff.newValue as
      | { article?: Article; platformIds?: string[]; createdAt?: number }
      | undefined
    if (!payload?.article) return

    useConsoleStore.setState({
      article: payload.article,
      selectedPlatforms: Array.isArray(payload.platformIds) ? payload.platformIds : [],
      notice: { kind: 'info', text: '已接收弹窗传来的文章，可以直接同步' },
    })
    chrome.storage.local.remove(HANDOFF_KEY).catch(() => {})
    window.location.hash = '#/sync'
  })
}

/**
 * 监听 background 推来的进度消息
 */
let listenerBound = false
export function bindConsoleProgressListener() {
  if (listenerBound) return
  listenerBound = true

  chrome.runtime.onMessage.addListener((message) => {
    const { sync } = useConsoleStore.getState()
    if (!sync.syncId) return
    if (message?.syncId && message.syncId !== sync.syncId) return

    if (message.type === 'SYNC_PROGRESS' && message.payload?.result) {
      const result = message.payload.result as SyncResult
      useConsoleStore.setState(state => ({
        sync: {
          ...state.sync,
          results: state.sync.results.some(r => r.platform === result.platform)
            ? state.sync.results.map(r => (r.platform === result.platform ? result : r))
            : [...state.sync.results, result],
        },
      }))
    }

    if (message.type === 'SYNC_DETAIL_PROGRESS' && message.payload?.platform) {
      const progress = message.payload as PlatformProgress
      useConsoleStore.setState(state => ({
        sync: { ...state.sync, stages: { ...state.sync.stages, [progress.platform]: progress } },
      }))
    }
  })
}

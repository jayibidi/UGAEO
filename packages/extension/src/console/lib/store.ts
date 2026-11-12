import { create } from 'zustand'
import { getPublishSettings, resolveDraftOnlyMap } from '../../lib/publish-settings'
import { extractArticleFromTab, describeExtractFailure } from '../../lib/tab-extractor'
import type {
  Article,
  ArticleSnapshot,
  CmsAccount,
  FailureItem,
  HistoryItem,
  Notice,
  Platform,
  PlatformProgress,
  SyncResult,
} from './types'

const SELECTED_PLATFORMS_KEY = 'selectedPlatforms'
const HANDOFF_KEY = 'consoleHandoff'
const HANDOFF_TTL = 30 * 60 * 1000

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
  sync: SyncState
  notice: Notice | null

  boot: () => Promise<void>
  refreshPlatforms: (force?: boolean) => Promise<void>
  recheckOne: (platformId: string) => Promise<void>
  openPlatform: (platform: { homepage: string }) => void

  setArticle: (article: Article | null) => void
  extractFromActiveTab: () => Promise<boolean>
  loadSnapshot: (syncId: string) => Promise<ArticleSnapshot | null>

  togglePlatform: (platformId: string) => void
  setSelected: (ids: string[]) => void
  selectAll: () => void
  deselectAll: () => void
  setPublishMode: (mode: 'draft' | 'publish') => void

  startSync: () => Promise<void>
  runSync: (
    article: Article,
    platformIds: string[],
    options?: { syncId?: string; mode?: 'draft' | 'publish' }
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
  sync: { running: false, syncId: null, results: [], stages: {}, error: null },
  notice: null,

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

    // 3. 发布设置 + 选中的平台
    try {
      const settings = await getPublishSettings()
      set({ publishMode: settings.mode === 'draft' ? 'draft' : 'publish' })
      const saved = await chrome.storage.local.get(SELECTED_PLATFORMS_KEY)
      if (Array.isArray(saved[SELECTED_PLATFORMS_KEY]) && !get().selectedPlatforms.length) {
        set({ selectedPlatforms: saved[SELECTED_PLATFORMS_KEY] as string[] })
      }
    } catch {
      // ignore
    }

    set({ booted: true })

    // 4. 实时刷新登录态（内部会更新 lastCheckedAt）
    get().refreshPlatforms(false).catch(() => {})
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

  setArticle: (article) => set({ article }),

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
      return true
    } catch (error) {
      set({ notice: { kind: 'error', text: `提取失败：${(error as Error).message}` } })
      return false
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

  setPublishMode: (mode) => set({ publishMode: mode }),

  startSync: async () => {
    const { article, selectedPlatforms } = get()
    if (!article) {
      set({ notice: { kind: 'error', text: '还没有待同步的文章' } })
      return
    }
    if (!selectedPlatforms.length) {
      set({ notice: { kind: 'error', text: '请先选择目标平台' } })
      return
    }
    await get().runSync(article, selectedPlatforms)
  },

  runSync: async (article, platformIds, options = {}) => {
    const syncId = options.syncId || newSyncId()
    const mode = options.mode || get().publishMode

    set({
      sync: { running: true, syncId, results: [], stages: {}, error: null },
      notice: null,
    })

    try {
      const settings = await getPublishSettings()
      const draftOnlyByPlatform = resolveDraftOnlyMap({ ...settings, mode }, platformIds, get().platforms)

      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: {
          article,
          platforms: platformIds,
          syncId,
          draftOnlyByPlatform,
          source: 'console',
        },
      })

      const results: SyncResult[] = (response?.results || []) as SyncResult[]
      const failed = results.filter(r => !r.success).length

      set(state => ({
        sync: { ...state.sync, running: false, results },
        notice: failed
          ? { kind: 'error', text: `同步完成：${results.length - failed} 个成功，${failed} 个失败，可在「失败处理」里排查` }
          : { kind: 'ok', text: `同步完成：${results.length} 个平台全部成功` },
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

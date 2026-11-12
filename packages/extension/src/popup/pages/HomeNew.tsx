import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, User, Clock, X, Download, Info, LayoutDashboard } from 'lucide-react'
import { useSyncStore } from '../stores/sync'
import { SettingsDrawer } from '../components/SettingsDrawer'
import { SyncDialog } from '@/components/sync-dialog'
import type { Platform as DialogPlatform } from '@/components/sync-dialog'
import { trackPageView, trackFeatureDiscovery } from '../../lib/analytics'
import { createLogger } from '../../lib/logger'
import { sendTabMessage } from '../../lib/messaging'
import { getCachedUpdateInfo, dismissUpdate, type UpdateCheckResult } from '../../lib/version-check'
import { getPublishSettings, savePublishSettings, type PublishMode } from '../../lib/publish-settings'
import { getAISettings, isAIReady } from '../../lib/ai-settings'

const logger = createLogger('HomeNew')

export function HomeNew() {
  const navigate = useNavigate()
  const {
    status,
    article,
    platforms,
    selectedPlatforms,
    results,
    error,
    extractHint,

    platformProgress,
    recovered,
    hiddenPlatforms,
    setHiddenPlatforms,
    loadPlatforms,
    loadArticle,
    recoverSyncState,
    togglePlatform,
    selectAll,
    deselectAll,
    retryFailed,
    reset,
    scheduledAt,
    updateArticle,
  } = useSyncStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null)
  const [allPlatforms, setAllPlatforms] = useState<DialogPlatform[]>([])
  const [publishMode, setPublishMode] = useState<PublishMode>('draft')
  const [aiReady, setAiReady] = useState(false)

  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [floatingEnabled, setFloatingEnabled] = useState(false)
  const [isFirstSync, setIsFirstSync] = useState(false)
  const [showShareTip, setShowShareTip] = useState(false)

  // Load data
  useEffect(() => {
    const init = async () => {
      await recoverSyncState()
      // Render from cache first, then refresh
      try {
        const cached = await chrome.storage.local.get('platformListCache')
        if (cached.platformListCache?.length) {
          setAllPlatforms(cached.platformListCache.map((p: any) => ({
            id: p.id, name: p.name, icon: p.icon,
            isAuthenticated: p.isAuthenticated, username: p.username,
            homepage: p.homepage, authMode: p.authMode,
          })))
        }
      } catch {}
      loadAllPlatforms()
      loadArticle()
      chrome.storage.local.get(['floatingButtonEnabled', 'syncHistory', 'dismissedShareTip'], (r) => {
        setFloatingEnabled(r.floatingButtonEnabled ?? false)
        setIsFirstSync(!r.syncHistory || r.syncHistory.length === 0)
        if (!r.dismissedShareTip) {
          setShowShareTip(true)
        }
      })
      const cached = await getCachedUpdateInfo()
      if (cached?.hasUpdate && cached.info) {
        setUpdateInfo(cached)
      }
      await refreshSettings()
    }
    init()
    trackPageView('home').catch(() => {})
  }, [])

  /** 读取发布模式与 AI 状态 */
  const refreshSettings = async () => {
    const [ps, ai] = await Promise.all([getPublishSettings(), getAISettings()])
    setPublishMode(ps.mode)
    setAiReady(isAIReady(ai))
  }

  /** 扩展重载后旧标签页里没有 content script，刷新一次即可恢复 */
  const handleReloadTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      await chrome.tabs.reload(tab.id)
      window.close()
    } catch {
      // 无视即可，用户也可以手动刷新
    }
  }

  const handleTogglePublishMode = async () => {
    // 草稿 ↔ 发布 二态切换；定时模式由设置页控制，点一下切回发布
    const next: PublishMode = publishMode === 'publish' ? 'draft' : 'publish'
    setPublishMode(next)
    await savePublishSettings({ mode: next })
  }

  const loadAllPlatforms = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH', payload: { forceRefresh: false } })
      const mapped: DialogPlatform[] = (response.platforms || []).map((p: any) => ({
        id: p.id, name: p.name, icon: p.icon,
        isAuthenticated: p.isAuthenticated, username: p.username,
        homepage: p.homepage, authMode: p.authMode,
      }))
      setAllPlatforms(mapped)
      await loadPlatforms()
    } catch (error) {
      logger.error('Failed to load platforms:', error)
    }
  }

  // Open editor
  const handleEditArticle = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await sendTabMessage(tab.id, {
          type: 'OPEN_EDITOR',
          platforms: allPlatforms.filter(p => !hiddenPlatforms.includes(p.id)),
          selectedPlatforms,
        })
      }
      window.close()
    } catch (err) {
      logger.error('Failed to open editor:', err)
    }
  }

  // Start sync with rate-limit check
  const handleStartSync = async () => {
    // 同步统一进独立 WEB 控制台：先查验账号登录态，失败后可直接返回编辑
    await openConsole('/sync')
  }

  /** 打开 WEB 控制台（把当前文章与选中平台交接过去） */
  const openConsole = async (path = '/') => {
    try {
      if (article) {
        await chrome.storage.local.set({
          consoleHandoff: {
            article,
            platformIds: selectedPlatforms,
            createdAt: Date.now(),
          },
        })
      }
      await chrome.runtime.sendMessage({ type: 'OPEN_CONSOLE', payload: { path } })
    } catch (err) {
      logger.error('Failed to open console:', err)
    }
    window.close()
  }

  const successCount = results.filter(r => r.success).length

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <img src="/assets/icon-48.png" alt="Logo" className="w-6 h-6" />
          <h1 className="font-semibold">UG·AEO</h1>
        </div>
        <nav className="flex items-center gap-0.5">
          <button
            onClick={() => openConsole('/')}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            title="打开 WEB 控制台"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="text-[10px] text-muted-foreground leading-none">控制台</span>
          </button>
          <button
            onClick={() => navigate('/accounts')}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
          >
            <User className="w-3.5 h-3.5" />
            <span className="text-[10px] text-muted-foreground leading-none">账号</span>
          </button>
          <button
            onClick={() => navigate('/history')}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="text-[10px] text-muted-foreground leading-none">历史</span>
          </button>
          <button
            onClick={() => navigate('/about')}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
            <span className="text-[10px] text-muted-foreground leading-none">关于</span>
          </button>
          <button
            onClick={() => {
              setSettingsOpen(true)
              trackFeatureDiscovery('settings', 'header_icon').catch(() => {})
            }}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-muted transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="text-[10px] text-muted-foreground leading-none">设置</span>
          </button>
        </nav>
      </header>

      {/* Version update banner */}
      {updateInfo?.hasUpdate && updateInfo.info && (
        <div className="px-4 pt-3">
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <Download className="w-4 h-4" />
                <span>新版本 v{updateInfo.info.version} 可用</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={updateInfo.info.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  下载
                </a>
                <button
                  onClick={async () => {
                    if (updateInfo.info) {
                      await dismissUpdate(updateInfo.info.version)
                      chrome.runtime.sendMessage({ type: 'CLEAR_UPDATE_BADGE' }).catch(() => {})
                      setUpdateInfo(null)
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="忽略此版本"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {updateInfo.info.releaseNotes && (
              <p className="text-xs text-muted-foreground mt-1">{updateInfo.info.releaseNotes}</p>
            )}
          </div>
        </div>
      )}

      {/* Share / welcome banner (first time only) */}
      {showShareTip && (
        <div className="px-4 pt-3">
          <div className="bg-muted/50 rounded-lg p-3 text-sm relative">
            <button
              onClick={() => {
                setShowShareTip(false)
                chrome.storage.local.set({ dismissedShareTip: true })
              }}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="font-medium mb-1.5">谢谢支持！</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              如果觉得本工具不错，还请分享给你的朋友！
              <br />
              想了解更多，欢迎访问{' '}
              <a
                href="https://api.ugooto-ai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                UGooTo
              </a>
            </p>
          </div>
        </div>
      )}

      {/* SyncDialog — the unified sync flow */}
      <SyncDialog
        article={article}
        platforms={allPlatforms.filter(p => !hiddenPlatforms.includes(p.id))}
        status={status}
        selectedPlatforms={selectedPlatforms}
        results={results}
        platformProgress={platformProgress}
        error={error}
        extractHint={extractHint?.text ?? null}
        onReloadTab={extractHint?.reloadable ? handleReloadTab : undefined}
        onTogglePlatform={togglePlatform}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onStartSync={handleStartSync}
        onRetryFailed={retryFailed}
        onReset={reset}
        onCancel={reset}
        onEditArticle={handleEditArticle}
        className="flex-1 min-h-0"
        publishMode={publishMode}
        onTogglePublishMode={handleTogglePublishMode}
        scheduledAt={scheduledAt}
        aiReady={aiReady}
        onUpdateArticle={updateArticle}
        consoleMode
      />

      {/* First sync success hint */}
      {status === 'completed' && isFirstSync && successCount > 0 && (
        <div className="px-4 pb-3">
          <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-2.5 space-y-1.5">
            <p className="text-xs font-medium text-green-700 dark:text-green-400">
              首次同步成功！以后同步更方便：
            </p>
            {!floatingEnabled && (
              <button
                onClick={() => {
                  chrome.storage.local.set({ floatingButtonEnabled: true })
                  setFloatingEnabled(true)
                }}
                className="text-xs text-primary hover:underline block"
              >
                开启悬浮按钮 — 在任意文章页一键同步
              </button>
            )}
            <p className="text-xs text-green-600 dark:text-green-500">
              下次在文章页点击扩展图标即可快速同步
            </p>
          </div>
        </div>
      )}

      {/* Settings drawer */}
      <SettingsDrawer open={settingsOpen} onClose={() => {
        setSettingsOpen(false)
        // 刷新隐藏平台配置（用户可能修改了），并把新隐藏的平台从已选中裁掉
        chrome.storage.local.get('hiddenPlatforms', (r) => {
          setHiddenPlatforms(r.hiddenPlatforms || [])
        })
        // 刷新发布模式与 AI 配置（可能刚在设置里改过）
        refreshSettings().catch(() => {})
      }} />

      {/* Rate limit warning (non-blocking toast) */}
      {rateLimitWarning && (
        <div className="fixed top-2 left-2 right-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 shadow-lg flex items-start gap-2">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-sm text-yellow-800 dark:text-yellow-200 flex-1">{rateLimitWarning}</p>
            <button
              onClick={() => setRateLimitWarning(null)}
              className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

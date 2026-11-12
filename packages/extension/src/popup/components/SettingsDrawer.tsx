import { useState, useEffect, useRef } from 'react'
import {
  X, Plug, PlugZap, Plus, Trash2, ChevronRight, ArrowLeft, Eye, EyeOff,
  Sparkles, Rocket, KeyRound, RefreshCw, Loader2, CheckCircle2, AlertCircle, Timer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackFeatureDiscovery } from '../../lib/analytics'
import {
  getPublishSettings,
  savePublishSettings,
  type PublishSettings,
  type PublishMode,
} from '../../lib/publish-settings'
import {
  getAISettings,
  saveAISettings,
  maskApiKey,
  DEFAULT_AI_SETTINGS,
  type AISettings,
  type AIFeatureToggles,
} from '../../lib/ai-settings'

const HIDDEN_PLATFORMS_KEY = 'hiddenPlatforms'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

interface PlatformInfo {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
  capabilities?: string[]
}

type DrawerView = 'main' | 'platforms' | 'ai' | 'publish'

interface McpStatus {
  enabled: boolean
  connected: boolean
  token?: string
  serverUrl?: string
}

interface CMSAccount {
  id: string
  name: string
  type: string
  url: string
}

const AI_FEATURE_LABELS: Array<{ key: keyof AIFeatureToggles; label: string; desc: string }> = [
  { key: 'title', label: '标题优化', desc: '生成多个更抓人的标题候选' },
  { key: 'summary', label: '摘要生成', desc: '自动生成导语/简介' },
  { key: 'tags', label: '标签推荐', desc: '按平台推荐话题标签' },
  { key: 'adapt', label: '平台风格适配', desc: '按目标平台调性改写正文' },
]

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const [mcpStatus, setMcpStatus] = useState<McpStatus>({ enabled: false, connected: false })
  const [cmsAccounts, setCmsAccounts] = useState<CMSAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [floatingButtonEnabled, setFloatingButtonEnabled] = useState(false)
  const [deepCleanEnabled, setDeepCleanEnabled] = useState(false)
  const [serverUrlInput, setServerUrlInput] = useState('')
  const serverUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [allPlatforms, setAllPlatforms] = useState<PlatformInfo[]>([])
  const [hiddenPlatforms, setHiddenPlatforms] = useState<Set<string>>(new Set())
  const [view, setView] = useState<DrawerView>('main')

  // 发布设置
  const [publishSettings, setPublishSettings] = useState<PublishSettings | null>(null)

  // AI 设置
  const [ai, setAi] = useState<AISettings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [aiBusy, setAiBusy] = useState<'models' | 'test' | null>(null)
  const [aiMessage, setAiMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const aiSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 定时任务队列
  const [scheduledJobs, setScheduledJobs] = useState<Array<{ id: string; title: string; publishAt: number; platforms: string[] }>>([])

  // 获取状态
  useEffect(() => {
    if (!open) { setView('main'); return }

    // MCP 状态
    chrome.runtime.sendMessage({ type: 'MCP_STATUS' }, (response) => {
      if (response && !response.error) {
        setMcpStatus({
          enabled: response.enabled ?? false,
          connected: response.connected ?? false,
          token: response.token,
          serverUrl: response.serverUrl,
        })
        setServerUrlInput(response.serverUrl || '')
      }
    })

    // CMS 账户
    chrome.storage.local.get('cmsAccounts', (result) => {
      setCmsAccounts(result.cmsAccounts || [])
    })

    // 悬浮按钮设置
    chrome.storage.local.get('floatingButtonEnabled', (result) => {
      setFloatingButtonEnabled(result.floatingButtonEnabled ?? false)
    })

    // 深度格式清理
    chrome.storage.local.get('deepCleanEnabled', (result) => {
      setDeepCleanEnabled(result.deepCleanEnabled ?? false)
    })

    // 发布设置 / AI 设置
    getPublishSettings().then(setPublishSettings).catch(() => {})
    getAISettings().then(setAi).catch(() => setAi({ ...DEFAULT_AI_SETTINGS }))

    // 加载平台列表和隐藏配置
    // 先用缓存立即渲染，避免「常用平台」入口在认证检查完成前不显示
    chrome.storage.local.get('platformListCache', (result) => {
      if (result.platformListCache?.length) {
        setAllPlatforms(prev => prev.length ? prev : result.platformListCache.map((p: any) => ({
          id: p.id, name: p.name, icon: p.icon, isAuthenticated: p.isAuthenticated, capabilities: p.capabilities,
        })))
      }
    })
    chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH', payload: { forceRefresh: false } }, (response) => {
      // 空数组/错误回包不清空已渲染的列表
      if (response?.platforms?.length) {
        setAllPlatforms(response.platforms.map((p: any) => ({
          id: p.id, name: p.name, icon: p.icon, isAuthenticated: p.isAuthenticated, capabilities: p.capabilities,
        })))
      }
    })
    chrome.storage.local.get(HIDDEN_PLATFORMS_KEY, (result) => {
      setHiddenPlatforms(new Set(result[HIDDEN_PLATFORMS_KEY] || []))
    })
  }, [open])

  // MCP 状态轮询 + 通知 background 加速重连
  useEffect(() => {
    if (!open || !mcpStatus.enabled) return

    // 通知 background：用户正在关注，加速重连
    chrome.runtime.sendMessage({ type: 'MCP_WATCH_START' })

    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'MCP_STATUS' }, (response) => {
        if (response && !response.error) {
          setMcpStatus(prev => ({ ...prev, connected: response.connected ?? false }))
        }
      })
    }, 3000)

    return () => {
      clearInterval(interval)
      // 设置页关闭，恢复正常重连策略
      chrome.runtime.sendMessage({ type: 'MCP_WATCH_STOP' })
    }
  }, [open, mcpStatus.enabled])

  // 切换 MCP
  const toggleMcp = async () => {
    setLoading(true)
    const action = mcpStatus.enabled ? 'MCP_DISABLE' : 'MCP_ENABLE'

    // 追踪 MCP 功能发现
    if (!mcpStatus.enabled) {
      trackFeatureDiscovery('mcp', 'settings').catch(() => {})
    }

    chrome.runtime.sendMessage({ type: action }, (response) => {
      setLoading(false)
      if (response?.success) {
        setMcpStatus(prev => ({
          ...prev,
          enabled: !prev.enabled,
          connected: false,
          token: response.token,  // 保存返回的 token
        }))
      }
    })
  }

  // 服务器地址变更（防抖 800ms）
  const handleServerUrlChange = (value: string) => {
    setServerUrlInput(value)
    if (serverUrlTimer.current) {
      clearTimeout(serverUrlTimer.current)
    }
    serverUrlTimer.current = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'MCP_SET_SERVER_URL',
        payload: { url: value.trim() },
      })
      setMcpStatus(prev => ({ ...prev, serverUrl: value.trim() }))
    }, 800)
  }

  // 切换悬浮按钮
  const toggleFloatingButton = () => {
    const next = !floatingButtonEnabled
    setFloatingButtonEnabled(next)
    chrome.storage.local.set({ floatingButtonEnabled: next })
  }

  // 切换深度格式清理
  const toggleDeepClean = () => {
    const next = !deepCleanEnabled
    setDeepCleanEnabled(next)
    chrome.storage.local.set({ deepCleanEnabled: next })
  }

  // 切换平台显示/隐藏
  const togglePlatformVisibility = (platformId: string) => {
    setHiddenPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(platformId)) {
        next.delete(platformId)
      } else {
        next.add(platformId)
      }
      chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: Array.from(next) })
      return next
    })
  }

  // 全选/全不选常用平台
  const showAllPlatforms = () => {
    setHiddenPlatforms(new Set())
    chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: [] })
  }
  const hideAllPlatforms = () => {
    const all = new Set(allPlatforms.map(p => p.id))
    setHiddenPlatforms(all)
    chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: Array.from(all) })
  }

  // 删除 CMS 账户
  const deleteCmsAccount = async (id: string) => {
    // 直接从 storage 读取最新数据，避免多窗口操作时覆盖
    const storage = await chrome.storage.local.get('cmsAccounts')
    const accounts: CMSAccount[] = storage.cmsAccounts || []
    const updated = accounts.filter(a => a.id !== id)
    await chrome.storage.local.set({ cmsAccounts: updated })
    await chrome.storage.local.remove(`cms_pwd_${id}`)
    setCmsAccounts(updated)
  }

  // ── 发布设置 ──

  const updatePublish = async (patch: Partial<PublishSettings>) => {
    const next = await savePublishSettings(patch)
    setPublishSettings(next)
  }

  const setPlatformMode = async (platformId: string, mode: 'draft' | 'publish') => {
    if (!publishSettings) return
    const overrides = { ...publishSettings.platformOverrides }
    if (mode === (publishSettings.mode === 'draft' ? 'draft' : 'publish')) {
      delete overrides[platformId]
    } else {
      overrides[platformId] = mode
    }
    await updatePublish({ platformOverrides: overrides })
  }

  // ── 定时任务队列 ──

  const refreshJobs = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SCHEDULE_LIST' })
      if (response?.ok) {
        setScheduledJobs(response.data || [])
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (view === 'publish') refreshJobs()
  }, [view])

  const cancelJob = async (id: string) => {
    await chrome.runtime.sendMessage({ type: 'SCHEDULE_CANCEL', payload: { id } })
    refreshJobs()
  }

  // ── AI 设置 ──

  const updateAi = (patch: Partial<AISettings>, immediate = false) => {
    setAi(prev => {
      const base = prev || { ...DEFAULT_AI_SETTINGS }
      return { ...base, ...patch }
    })
    if (aiSaveTimer.current) clearTimeout(aiSaveTimer.current)
    const persist = () => {
      saveAISettings(patch).catch(() => {})
    }
    if (immediate) {
      persist()
    } else {
      aiSaveTimer.current = setTimeout(persist, 700)
    }
  }

  const toggleAiFeature = (key: keyof AIFeatureToggles) => {
    if (!ai) return
    const features = { ...ai.features, [key]: !ai.features[key] }
    updateAi({ features }, true)
  }

  const fetchModels = async () => {
    if (!ai) return
    setAiBusy('models')
    setAiMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AI_LIST_MODELS',
        payload: { baseUrl: ai.baseUrl, apiKey: ai.apiKey },
      })
      if (!response?.ok) throw new Error(response?.error || '拉取失败')
      const models: string[] = response.data || []
      const nextModel = ai.model && models.includes(ai.model) ? ai.model : models[0] || ai.model
      setAi(prev => prev ? { ...prev, models, model: nextModel } : prev)
      await saveAISettings({ models, model: nextModel })
      setAiMessage({ type: 'ok', text: `已拉取 ${models.length} 个模型` })
    } catch (error) {
      setAiMessage({ type: 'error', text: (error as Error).message })
    } finally {
      setAiBusy(null)
    }
  }

  const testAI = async () => {
    if (!ai) return
    setAiBusy('test')
    setAiMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AI_TEST',
        payload: { baseUrl: ai.baseUrl, apiKey: ai.apiKey, model: ai.model },
      })
      if (!response?.ok) throw new Error(response?.error || '测试失败')
      setAiMessage({
        type: 'ok',
        text: `连接正常 · ${response.data.model} · ${response.data.latency}ms`,
      })
    } catch (error) {
      setAiMessage({ type: 'error', text: (error as Error).message })
    } finally {
      setAiBusy(null)
    }
  }

  if (!open) return null

  // 按当前列表过滤计算，避免 hiddenPlatforms 含已下线平台时计数偏小甚至为负
  const shownCount = allPlatforms.filter(p => !hiddenPlatforms.has(p.id)).length
  const currentMode: PublishMode = publishSettings?.mode ?? 'draft'

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* 抽屉 */}
      <div className={cn(
        'fixed inset-y-0 right-0 w-80 bg-background z-50 shadow-xl',
        'transform transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full'
      )}>
        {view === 'platforms' ? (
          <>
            {/* 常用平台子页 头部 */}
            <div className="flex items-center gap-2 p-4 border-b">
              <button onClick={() => setView('main')} className="p-1 rounded hover:bg-muted">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-semibold flex-1">常用平台</h2>
              <span className="text-xs text-muted-foreground">
                {shownCount}/{allPlatforms.length}
              </span>
            </div>

            {/* 常用平台子页 内容 */}
            <div className="flex flex-col h-[calc(100%-57px)]">
              {/* 全选/全不选 */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b">
                <button
                  onClick={showAllPlatforms}
                  className="text-xs text-primary hover:underline"
                >
                  全选
                </button>
                <span className="text-xs text-muted-foreground">|</span>
                <button
                  onClick={hideAllPlatforms}
                  className="text-xs text-primary hover:underline"
                >
                  全不选
                </button>
                <p className="text-xs text-muted-foreground ml-auto">点击切换显示/隐藏</p>
              </div>

              {/* 平台列表 */}
              <div className="flex-1 overflow-y-auto">
                {allPlatforms.map(platform => {
                  const isHidden = hiddenPlatforms.has(platform.id)
                  return (
                    <div
                      key={platform.id}
                      onClick={() => togglePlatformVisibility(platform.id)}
                      className={cn(
                        'flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/40 last:border-b-0',
                        isHidden && 'opacity-40',
                      )}
                    >
                      <img
                        src={platform.icon}
                        alt={platform.name}
                        className="w-5 h-5 rounded flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).src = '/assets/icon-48.png' }}
                      />
                      <span className="text-sm flex-1 truncate">{platform.name}</span>
                      {isHidden ? (
                        <EyeOff className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <Eye className="w-4 h-4 text-primary flex-shrink-0" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : view === 'publish' ? (
          <>
            {/* 发布模式子页 头部 */}
            <div className="flex items-center gap-2 p-4 border-b">
              <button onClick={() => setView('main')} className="p-1 rounded hover:bg-muted">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-semibold flex-1">发布模式</h2>
              <Rocket className="w-4 h-4 text-primary" />
            </div>

            <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-57px)]">
              <div className="space-y-2">
                {([
                  { key: 'draft', label: '存为草稿', desc: '只创建草稿，由你到各平台确认后手动发布' },
                  { key: 'publish', label: '立即发布', desc: '同步时直接在支持的平台公开发布' },
                  { key: 'scheduled', label: '定时发布', desc: '先入队，到点由浏览器自动发布' },
                ] as Array<{ key: PublishMode; label: string; desc: string }>).map(item => (
                  <button
                    key={item.key}
                    onClick={() => updatePublish({ mode: item.key })}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      currentMode === item.key
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-muted/40 hover:bg-muted'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-3.5 h-3.5 rounded-full border-2 flex-shrink-0',
                        currentMode === item.key ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                      )} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-5">{item.desc}</p>
                  </button>
                ))}
              </div>

              {currentMode === 'scheduled' && (
                <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5" />
                    延迟时间
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={publishSettings?.delayMinutes ?? 30}
                      onChange={(e) => updatePublish({ delayMinutes: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-20 bg-background p-1.5 rounded border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-xs text-muted-foreground">分钟后执行（最多 1440 分钟）</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    定时任务依赖浏览器保持运行；若设置的时刻浏览器未开启，会在下次启动时补执行。
                  </p>
                </div>
              )}

              {/* 平台覆盖 */}
              {currentMode !== 'draft' && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">按平台调整</p>
                  <p className="text-[11px] text-muted-foreground">
                    未声明发布能力的平台会自动降级为草稿
                  </p>
                  <div className="space-y-1">
                    {allPlatforms.map(platform => {
                      const canPublish = (platform.capabilities || []).includes('publish')
                      const overrideMode = publishSettings?.platformOverrides[platform.id]
                      const effective = canPublish ? (overrideMode || 'publish') : 'draft'
                      return (
                        <div key={platform.id} className="flex items-center gap-2 p-2 bg-muted/40 rounded-lg">
                          <img
                            src={platform.icon}
                            alt=""
                            className="w-4 h-4 rounded flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/icon-48.png' }}
                          />
                          <span className="text-xs flex-1 truncate">{platform.name}</span>
                          {canPublish ? (
                            <div className="flex rounded-md overflow-hidden border border-border">
                              {(['draft', 'publish'] as const).map(mode => (
                                <button
                                  key={mode}
                                  onClick={() => setPlatformMode(platform.id, mode)}
                                  className={cn(
                                    'px-1.5 py-0.5 text-[10px] transition-colors',
                                    effective === mode
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-background hover:bg-muted'
                                  )}
                                >
                                  {mode === 'draft' ? '草稿' : '发布'}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">仅草稿</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 待执行任务 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">待执行任务</p>
                  <button onClick={refreshJobs} className="text-[11px] text-primary hover:underline">
                    刷新
                  </button>
                </div>
                {scheduledJobs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-2">
                    暂无定时任务。选择「定时发布」后点击同步即可入队。
                  </p>
                ) : (
                  <div className="space-y-1">
                    {scheduledJobs.map(job => (
                      <div key={job.id} className="flex items-start gap-2 p-2 bg-muted/40 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{job.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(job.publishAt).toLocaleString('zh-CN', {
                              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                            {' · '}
                            {job.platforms.length} 个平台
                          </p>
                        </div>
                        <button
                          onClick={() => cancelJob(job.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:text-destructive flex-shrink-0"
                        >
                          取消
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : view === 'ai' ? (
          <>
            {/* AI 子页 头部 */}
            <div className="flex items-center gap-2 p-4 border-b">
              <button onClick={() => setView('main')} className="p-1 rounded hover:bg-muted">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-semibold flex-1">AI 模型</h2>
              <Sparkles className="w-4 h-4 text-violet-500" />
            </div>

            <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-57px)]">
              {/* 总开关 */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">启用 AI 能力</p>
                  <p className="text-xs text-muted-foreground">标题、摘要、标签与平台适配</p>
                </div>
                <button
                  onClick={() => updateAi({ enabled: !ai?.enabled }, true)}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                    ai?.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                >
                  <span className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                    ai?.enabled ? 'translate-x-6' : 'translate-x-1'
                  )} />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">API 地址（OpenAI 兼容）</label>
                <input
                  type="text"
                  value={ai?.baseUrl ?? ''}
                  onChange={(e) => updateAi({ baseUrl: e.target.value })}
                  placeholder="https://api.ugooto-ai.com/v1"
                  className="w-full bg-muted/50 p-2 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  默认已填好你的中转站，留空则使用 https://api.ugooto-ai.com/v1
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <KeyRound className="w-3 h-3" />
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={ai?.apiKey ?? ''}
                    onChange={(e) => updateAi({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-muted/50 p-2 pr-8 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  仅保存在本机浏览器，{ai?.apiKey ? `当前 ${maskApiKey(ai.apiKey)}` : '不会上传到任何服务器'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">模型</label>
                  <button
                    onClick={fetchModels}
                    disabled={aiBusy !== null}
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                  >
                    {aiBusy === 'models'
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <RefreshCw className="w-3 h-3" />}
                    拉取模型
                  </button>
                </div>
                {ai && ai.models.length > 0 ? (
                  <select
                    value={ai.model}
                    onChange={(e) => updateAi({ model: e.target.value }, true)}
                    className="w-full bg-muted/50 p-2 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {!ai.models.includes(ai.model) && ai.model && (
                      <option value={ai.model}>{ai.model}（自定义）</option>
                    )}
                    {ai.models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={ai?.model ?? ''}
                    onChange={(e) => updateAi({ model: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className="w-full bg-muted/50 p-2 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
                <p className="text-[10px] text-muted-foreground">
                  可填任意模型名；拉取后可从列表中选择不同模型
                </p>
              </div>

              <button
                onClick={testAI}
                disabled={aiBusy !== null || !ai?.apiKey}
                className={cn(
                  'w-full py-2 rounded-lg text-xs font-medium transition-colors',
                  'bg-muted hover:bg-muted/70 disabled:opacity-50'
                )}
              >
                {aiBusy === 'test' ? '测试中…' : '测试连接'}
              </button>

              {aiMessage && (
                <div className={cn(
                  'flex items-start gap-1.5 text-[11px] p-2 rounded',
                  aiMessage.type === 'ok'
                    ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                    : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                )}>
                  {aiMessage.type === 'ok'
                    ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  <span className="leading-relaxed">{aiMessage.text}</span>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-muted-foreground">启用哪些能力</p>
                {AI_FEATURE_LABELS.map(item => (
                  <div key={item.key} className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => toggleAiFeature(item.key)}
                      className={cn(
                        'relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ml-2',
                        ai?.features[item.key] ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        ai?.features[item.key] ? 'translate-x-4' : 'translate-x-0.5'
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 主设置 头部 */}
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold">设置</h2>
              <button onClick={onClose} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 主设置 内容 */}
            <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-57px)]">
              {/* 发布 & AI */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">发布与智能</h3>

                <button
                  onClick={() => setView('publish')}
                  className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2 text-left">
                    <Rocket className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">发布模式</p>
                      <p className="text-xs text-muted-foreground">
                        {currentMode === 'publish'
                          ? '立即发布 · 同步后直接公开'
                          : currentMode === 'scheduled'
                            ? `定时发布 · ${publishSettings?.delayMinutes ?? 30} 分钟后执行`
                            : '存为草稿 · 手动确认后发布'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>

                <button
                  onClick={() => setView('ai')}
                  className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2 text-left">
                    <Sparkles className="w-5 h-5 text-violet-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">AI 模型</p>
                      <p className="text-xs text-muted-foreground">
                        {ai?.enabled
                          ? `已启用 · ${ai.model || '未选择模型'}`
                          : '未启用 · 接入中转站后可优化内容'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              </div>

              {/* 同步桥接设置 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">同步桥接</h3>

                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    {mcpStatus.connected ? (
                      <PlugZap className="w-5 h-5 text-green-500" />
                    ) : (
                      <Plug className="w-5 h-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">CLI / MCP 连接</p>
                      <p className="text-xs text-muted-foreground">
                        {mcpStatus.enabled
                          ? mcpStatus.connected ? '已连接' : '等待连接...'
                          : '未启用'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={toggleMcp}
                    disabled={loading}
                    className={cn(
                      'relative w-11 h-6 rounded-full transition-colors',
                      mcpStatus.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                      loading && 'opacity-50'
                    )}
                  >
                    <span className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                      mcpStatus.enabled ? 'translate-x-6' : 'translate-x-1'
                    )} />
                  </button>
                </div>

                {mcpStatus.enabled && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      供 CLI 和 MCP Server 通过 WebSocket 桥接同步文章
                    </p>
                    {mcpStatus.token && (
                      <div className="p-2 bg-muted/50 rounded text-xs">
                        <p className="text-muted-foreground mb-1">Token:</p>
                        <code className="block bg-background p-1.5 rounded break-all select-all">
                          {mcpStatus.token}
                        </code>
                      </div>
                    )}
                    <div className="p-2 bg-muted/50 rounded text-xs">
                      <p className="text-muted-foreground mb-1">服务器地址 (留空使用本地默认):</p>
                      <input
                        type="text"
                        value={serverUrlInput}
                        onChange={(e) => handleServerUrlChange(e.target.value)}
                        placeholder="ws://localhost:9527"
                        className="w-full bg-background p-1.5 rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 悬浮同步按钮 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">网页功能</h3>

                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">悬浮同步按钮</p>
                    <p className="text-xs text-muted-foreground">在网页右下角显示快捷同步按钮</p>
                  </div>
                  <button
                    onClick={toggleFloatingButton}
                    className={cn(
                      'relative w-11 h-6 rounded-full transition-colors',
                      floatingButtonEnabled ? 'bg-primary' : 'bg-muted-foreground/30',
                    )}
                  >
                    <span className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                      floatingButtonEnabled ? 'translate-x-6' : 'translate-x-1'
                    )} />
                  </button>
                </div>
              </div>

              {/* 常用平台 — 入口行（无条件渲染，数据未到时显示加载占位而不是整块消失） */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">同步设置</h3>
                <button
                  onClick={() => setView('platforms')}
                  disabled={allPlatforms.length === 0}
                  className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors disabled:opacity-60"
                >
                  <div className="text-left">
                    <p className="text-sm font-medium">常用平台</p>
                    <p className="text-xs text-muted-foreground">
                      {allPlatforms.length > 0
                        ? `隐藏不需要的平台 · ${shownCount}/${allPlatforms.length} 个显示`
                        : '加载平台列表中…'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              </div>

              {/* 高级选项 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">高级选项</h3>

                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">深度格式清理</p>
                    <p className="text-xs text-muted-foreground">同步前通过 Markdown 转换清理格式，可能损失部分排版</p>
                  </div>
                  <button
                    onClick={toggleDeepClean}
                    className={cn(
                      'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                      deepCleanEnabled ? 'bg-primary' : 'bg-muted-foreground/30',
                    )}
                  >
                    <span className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                      deepCleanEnabled ? 'translate-x-6' : 'translate-x-1'
                    )} />
                  </button>
                </div>
              </div>

              {/* CMS 账户 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">自建站点</h3>
                  <button
                    onClick={() => { onClose(); window.location.hash = '/accounts' }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    添加
                  </button>
                </div>

                {cmsAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">暂无自建站点</p>
                ) : (
                  <div className="space-y-2">
                    {cmsAccounts.map(account => (
                      <div key={account.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{account.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{account.url}</p>
                        </div>
                        <button
                          onClick={() => deleteCmsAccount(account.id)}
                          className="p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 历史记录 */}
              <div className="space-y-3">
                <button
                  onClick={() => { onClose(); window.location.hash = '/history' }}
                  className="flex items-center justify-between w-full p-3 bg-muted/50 rounded-lg hover:bg-muted"
                >
                  <span className="text-sm font-medium">查看全部历史</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

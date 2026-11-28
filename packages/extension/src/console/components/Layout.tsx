import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Info,
  LayoutDashboard,
  MessageSquare,
  PenLine,
  RefreshCw,
  ScanSearch,
  Send,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { isLocalToolPlatform } from '@ugaeo/core'
import { getAISettings, saveAISettings, type AISettings } from '../../lib/ai-settings'
import { AISettingsDialog } from './AISettingsDialog'
import { useConsoleStore } from '../lib/store'

const NAV = [
  { to: '/', label: '概览', icon: LayoutDashboard, desc: '账号与同步总览' },
  { to: '/ai-chat', label: 'AI 对话', icon: MessageSquare, desc: '选题、写稿、生图，边聊边创作' },
  { to: '/compose', label: 'AI 创作', icon: PenLine, desc: '待同步文章、编辑器与 AI 模型配置' },
  { to: '/sync', label: '同步', icon: Send, desc: '选择平台并发布文章' },
  { to: '/accounts', label: '账号', icon: Users, desc: '多平台登录状态查验' },
  { to: '/history', label: '记录', icon: History, desc: '每次同步的明细' },
  { to: '/failures', label: '失败处理', icon: AlertTriangle, desc: '失败原因与返回编辑' },
  { to: '/diagnostics', label: '自检', icon: ScanSearch, desc: '逐平台验证通不通、有没有坑' },
]

function TopBar() {
  const location = useLocation()
  const current = NAV.find(item => item.to === location.pathname) || NAV[0]
  const { loadingPlatforms, checkingAll, refreshPlatforms } = useConsoleStore()
  const busy = loadingPlatforms || checkingAll

  return (
    <header className="flex items-center justify-between gap-4 border-b bg-background/80 px-8 py-4 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold">{current.label}</h1>
        <p className="text-xs text-muted-foreground">{current.desc}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="uga-btn-secondary"
          onClick={() => refreshPlatforms(true)}
          disabled={busy}
          title="重新检测所有平台登录状态"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          {busy ? '检测中' : '检测登录态'}
        </button>
        <button
          className="uga-btn-ghost"
          onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE' }).catch(() => {})}
          title="打开扩展弹窗"
        >
          <Settings2 className="h-4 w-4" />
          扩展弹窗
        </button>
      </div>
    </header>
  )
}

function NoticeBar() {
  const { notice, setNotice } = useConsoleStore()

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  if (!notice) return null

  const tone =
    notice.kind === 'ok'
      ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
      : notice.kind === 'error'
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'

  const Icon = notice.kind === 'ok' ? CheckCircle2 : notice.kind === 'error' ? AlertTriangle : Info

  return (
    <div className={`mx-8 mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{notice.text}</span>
      <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * 侧边栏上的 AI 总开关
 *
 * 需求是「把 AI 功能的开关直接做到菜单里」：不用先进某一页翻设置，
 * 在左侧就能看到当前状态并一键开关。真正配置中转站/Key/模型在 AI 创作页。
 */
function AIStatusCard() {
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    getAISettings().then(setSettings).catch(() => {})
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.aiSettings) {
        const next = changes.aiSettings.newValue as AISettings | undefined
        if (next) setSettings(prev => (prev ? { ...prev, ...next } : next))
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const enabled = settings?.enabled ?? false
  const ready = enabled && !!settings?.apiKey?.trim() && !!settings?.model?.trim()

  const toggle = () => {
    const next = !enabled
    setSettings(prev => (prev ? { ...prev, enabled: next } : prev))
    saveAISettings({ enabled: next }).catch(() => {})
  }

  return (
    <>
      <div className="mx-3 mb-2 rounded-lg border bg-background p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className={`h-3.5 w-3.5 ${ready ? 'text-violet-500' : 'text-muted-foreground'}`} />
            AI 能力
          </span>
          <button
            onClick={toggle}
            role="switch"
            aria-checked={enabled}
            aria-label="启用 AI 能力"
            className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
              enabled ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {ready ? (
          <>
            <div className="mt-1.5 flex items-start gap-1">
              <div className="min-w-0 flex-1 space-y-0.5 text-[10.5px] text-muted-foreground">
                <span className="block truncate" title={settings?.model}>
                  文本 · {settings?.model}
                </span>
                <span className="block truncate" title={settings?.imageModel || '未选生图模型'}>
                  生图 · {settings?.imageModel || '未选'}
                </span>
              </div>
              <button
                onClick={() => setDialogOpen(true)}
                className="flex-shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="调整模型"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 leading-relaxed text-muted-foreground">
              {enabled ? '还差 API Key 或模型，补全后即可使用' : '接入中转站后可用一键成稿、AI 对话与配图'}
            </p>
            {/* 这里是控制台里唯一的配置入口，做成实心按钮，别再藏成一行小字 */}
            <button
              onClick={() => setDialogOpen(true)}
              className="uga-btn-primary mt-2 w-full justify-center px-2 py-1.5 text-[11.5px] font-medium"
            >
              <Settings2 className="h-3.5 w-3.5" />
              去配置 AI
            </button>
          </>
        )}
      </div>

      <AISettingsDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  // CMS 站点没有「登录态」概念；本地工具（Markdown 压缩包）也不是平台，都不进分母
  const platformCount = useConsoleStore(
    state => state.platforms.filter(p => p.sourceType !== 'cms' && !isLocalToolPlatform(p.id)).length
  )
  const authedCount = useConsoleStore(
    state =>
      state.platforms.filter(p => p.sourceType !== 'cms' && p.isAuthenticated && !isLocalToolPlatform(p.id)).length
  )

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/assets/icon-48.png" alt="UG·AEO" className="h-8 w-8 rounded-lg" />
          <div>
            <div className="text-sm font-semibold leading-tight">UG·AEO</div>
            <div className="text-[11px] text-muted-foreground">多平台发布控制台</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-background font-medium shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <AIStatusCard />

        <div className="m-3 rounded-lg border bg-background p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">登录状态</span>
            <span className="font-medium">
              {authedCount}/{platformCount}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${platformCount ? (authedCount / platformCount) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            状态由各平台 Cookie 实测得出，并非浏览器登录缓存。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <NoticeBar />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          {/* 用 flex 撑满高度：AI 对话这类需要垂直居中的页面才有确定的可用高度 */}
          <div className="mx-auto flex min-h-full w-full max-w-[1320px] flex-col">{children}</div>
        </main>
      </div>
    </div>
  )
}

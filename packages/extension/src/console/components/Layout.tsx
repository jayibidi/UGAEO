import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Info,
  LayoutDashboard,
  RefreshCw,
  ScanSearch,
  Send,
  Settings2,
  Users,
  X,
} from 'lucide-react'
import { useConsoleStore } from '../lib/store'

const NAV = [
  { to: '/', label: '概览', icon: LayoutDashboard, desc: '账号与同步总览' },
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

export function Layout({ children }: { children: React.ReactNode }) {
  // CMS 站点没有「登录态」概念，比例只统计平台适配器
  const platformCount = useConsoleStore(state => state.platforms.filter(p => p.sourceType !== 'cms').length)
  const authedCount = useConsoleStore(
    state => state.platforms.filter(p => p.sourceType !== 'cms' && p.isAuthenticated).length
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
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>
    </div>
  )
}

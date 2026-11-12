import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, LogIn, Send, Users } from 'lucide-react'
import { collectFailures, useConsoleStore } from '../lib/store'
import { formatRelative } from '../lib/format'
import { PlatformIcon, ResultPill } from '../components/PlatformBadge'

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Users
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warn' | 'ok'
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'ok'
        ? 'text-green-600 dark:text-green-400'
        : 'text-foreground'

  return (
    <div className="uga-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function OverviewPage() {
  const { platforms, history, lastCheckedAt, openPlatform, refreshPlatforms, refreshHistory } = useConsoleStore()

  useEffect(() => {
    refreshHistory().catch(() => {})
  }, [refreshHistory])

  const dslPlatforms = platforms.filter(p => p.sourceType !== 'cms')
  const authed = dslPlatforms.filter(p => p.isAuthenticated)
  const unauthed = dslPlatforms.filter(p => !p.isAuthenticated)
  const failures = useMemo(() => collectFailures(history, 7), [history])
  const weekSyncs = useMemo(
    () => history.filter(item => (item.endTime || item.startTime) > Date.now() - 7 * 86400000),
    [history]
  )
  const recent = history.slice(0, 4)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="已登录平台"
          value={`${authed.length}/${dslPlatforms.length}`}
          hint={lastCheckedAt ? `检测于 ${formatRelative(lastCheckedAt)}` : '尚未检测'}
          tone={authed.length ? 'ok' : 'warn'}
        />
        <StatCard icon={Clock3} label="近 7 天同步" value={weekSyncs.length} hint={`历史共 ${history.length} 条`} />
        <StatCard
          icon={AlertTriangle}
          label="近 7 天失败"
          value={failures.length}
          hint={failures.length ? '可在失败处理里重新编辑发布' : '暂无失败'}
          tone={failures.length ? 'warn' : 'ok'}
        />
        <StatCard
          icon={CheckCircle2}
          label="可直接发布的平台"
          value={authed.filter(p => (p.capabilities || []).includes('publish')).length}
          hint="其余平台只能存草稿"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="uga-card col-span-2 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">最近同步</h2>
            <Link to="/history" className="flex items-center gap-1 text-xs text-primary hover:underline">
              全部记录 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              还没有同步记录，去「同步」页发布第一篇文章吧。
            </div>
          ) : (
            <div className="divide-y">
              {recent.map(item => {
                const failed = (item.results || []).filter(r => !r.success).length
                return (
                  <Link key={item.id} to="/history" className="flex items-center gap-3 py-3 hover:bg-muted/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatRelative(item.endTime || item.startTime)} · {item.results.length} 个平台
                        {failed ? ` · ${failed} 个失败` : ''}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 gap-1">
                      {(item.results || []).slice(0, 3).map(result => (
                        <ResultPill key={result.platform} result={result} />
                      ))}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div className="uga-card p-5">
          <h2 className="mb-3 text-sm font-medium">快捷入口</h2>
          <div className="space-y-2">
            <Link to="/sync" className="uga-btn-primary w-full">
              <Send className="h-4 w-4" /> 进入同步
            </Link>
            <Link to="/failures" className="uga-btn-secondary w-full">
              <AlertTriangle className="h-4 w-4" /> 处理失败（{failures.length}）
            </Link>
            <button className="uga-btn-secondary w-full" onClick={() => refreshPlatforms(true)}>
              <Users className="h-4 w-4" /> 重新检测登录态
            </button>
          </div>
        </div>
      </div>

      {unauthed.length > 0 && (
        <div className="uga-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">未登录平台（{unauthed.length}）</h2>
            <Link to="/accounts" className="text-xs text-primary hover:underline">
              账号管理
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {unauthed.slice(0, 8).map(platform => (
              <button
                key={platform.id}
                onClick={() => openPlatform(platform)}
                className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left hover:bg-muted/50"
              >
                <PlatformIcon icon={platform.icon} name={platform.name} size={16} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{platform.name}</span>
                <LogIn className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

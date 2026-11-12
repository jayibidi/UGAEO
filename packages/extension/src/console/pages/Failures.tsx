import { useMemo, useState } from 'react'
import { AlertTriangle, LogIn, Loader2, PencilLine, RotateCcw } from 'lucide-react'
import { collectFailures, useConsoleStore } from '../lib/store'
import { PlatformIcon } from '../components/PlatformBadge'
import { EditArticleModal } from '../components/EditArticleModal'
import { formatDate, formatRelative } from '../lib/format'
import type { FailureItem } from '../lib/types'

const WINDOWS = [
  { days: 1, label: '24 小时' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
]

export function FailuresPage() {
  const { history, platforms, runSync, loadSnapshot, openPlatform, setNotice } = useConsoleStore()

  const [days, setDays] = useState(7)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'auth' | 'publish'>('all')
  const [editing, setEditing] = useState<{ syncId: string; platform: string; draftOnly: boolean } | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const failures = useMemo(() => collectFailures(history, days), [history, days])

  const filtered = useMemo(
    () =>
      failures.filter(item => {
        if (platformFilter !== 'all' && item.platform !== platformFilter) return false
        if (kindFilter !== 'all' && item.kind !== kindFilter) return false
        return true
      }),
    [failures, platformFilter, kindFilter]
  )

  const platformOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of failures) map.set(item.platform, item.platformName)
    return [...map.entries()]
  }, [failures])

  const platformMeta = (id: string) => platforms.find(p => p.id === id)

  const retry = async (item: FailureItem) => {
    const key = `${item.syncId}-${item.platform}`
    setRetrying(key)
    try {
      const snapshot = await loadSnapshot(item.syncId)
      if (!snapshot?.title || !(snapshot.markdown || snapshot.html || snapshot.content)) {
        setEditing({ syncId: item.syncId, platform: item.platform, draftOnly: !!item.draftOnly })
        setNotice({ kind: 'info', text: '这篇没有正文快照，请先补齐正文再重发' })
        return
      }

      const article = {
        title: snapshot.title,
        markdown: snapshot.markdown,
        html: snapshot.html,
        content: snapshot.content,
        summary: snapshot.summary,
        tags: snapshot.tags,
        cover: snapshot.cover,
        source: snapshot.source,
      }
      const results = await runSync(article, [item.platform], {
        mode: item.draftOnly ? 'draft' : 'publish',
      })
      const result = results[0]
      if (result?.success) {
        setNotice({
          kind: 'ok',
          text: `${item.platformName} 重发成功${result.postUrl ? '，可点开链接确认' : ''}`,
        })
      }
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="uga-card flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className={`h-4 w-4 ${filtered.length ? 'text-red-500' : 'text-muted-foreground'}`} />
          <span className="font-medium">{filtered.length}</span>
          <span className="text-muted-foreground">条待处理失败</span>
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {WINDOWS.map(item => (
            <button
              key={item.days}
              onClick={() => setDays(item.days)}
              className={`rounded-md px-2.5 py-1 ${days === item.days ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <select
          className="uga-input w-40 py-1.5 text-xs"
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
        >
          <option value="all">全部平台</option>
          {platformOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {([
            ['all', '全部'],
            ['auth', '登录问题'],
            ['publish', '发布问题'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setKindFilter(key)}
              className={`rounded-md px-2.5 py-1 ${kindFilter === key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="uga-card p-12 text-center">
          <p className="text-sm text-muted-foreground">这个时间范围内没有失败记录</p>
          <p className="mt-1 text-xs text-muted-foreground">失败会保留在这里，直到你重发成功或记录过期</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const key = `${item.syncId}-${item.platform}`
            const meta = platformMeta(item.platform)
            return (
              <div key={key} className="uga-card p-4">
                <div className="flex items-start gap-3">
                  <PlatformIcon icon={meta?.icon} name={item.platformName} size={20} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.platformName}</span>
                      <span
                        className={`uga-chip ${
                          item.kind === 'auth'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {item.kind === 'auth' ? '登录态失效' : '发布失败'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelative(item.time)} · {formatDate(item.time)}
                      </span>
                    </div>

                    <div className="mt-1 truncate text-sm text-muted-foreground">《{item.title}》</div>

                    <div className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-950/30 dark:text-red-300">
                      {item.error}
                    </div>

                    {item.message && (
                      <div className="mt-1 text-[11px] text-muted-foreground">{item.message}</div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
                  <button
                    className="uga-btn-secondary px-2 py-1 text-xs"
                    onClick={() => retry(item)}
                    disabled={retrying === key}
                  >
                    {retrying === key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    重试
                  </button>
                  <button
                    className="uga-btn-primary px-2 py-1 text-xs"
                    onClick={() =>
                      setEditing({ syncId: item.syncId, platform: item.platform, draftOnly: !!item.draftOnly })
                    }
                  >
                    <PencilLine className="h-3.5 w-3.5" /> 返回编辑
                  </button>
                  <button
                    className="uga-btn-ghost px-2 py-1 text-xs"
                    onClick={() => meta && openPlatform(meta)}
                  >
                    <LogIn className="h-3.5 w-3.5" /> 去登录
                  </button>
                  {item.postUrl && (
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="uga-btn-ghost px-2 py-1 text-xs text-primary"
                    >
                      打开草稿
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EditArticleModal
        open={!!editing}
        onClose={() => setEditing(null)}
        syncId={editing?.syncId}
        defaultPlatforms={editing ? [editing.platform] : []}
        defaultMode={editing?.draftOnly ? 'draft' : 'publish'}
      />
    </div>
  )
}

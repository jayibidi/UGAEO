import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, PencilLine, RefreshCw } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformIcon, ResultPill } from '../components/PlatformBadge'
import { EditArticleModal } from '../components/EditArticleModal'
import { formatDate, formatRelative, reviewText } from '../lib/format'

export function HistoryPage() {
  const { history, platforms, refreshHistory } = useConsoleStore()
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ syncId: string; platforms: string[]; draftOnly: boolean } | null>(null)

  useEffect(() => {
    refreshHistory().catch(() => {})
  }, [refreshHistory])

  const items = useMemo(() => {
    const sorted = [...history].sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
    if (!onlyFailed) return sorted
    return sorted.filter(item => (item.results || []).some(result => !result.success || result.reviewStatus === 'rejected'))
  }, [history, onlyFailed])

  const platformMeta = (id: string) => platforms.find(p => p.id === id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {[
            [false, '全部记录'],
            [true, '只看失败'],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              onClick={() => setOnlyFailed(value as boolean)}
              className={`rounded-md px-2.5 py-1 ${onlyFailed === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">共 {items.length} 条</span>
        <button className="uga-btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => refreshHistory()}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>

      {items.length === 0 ? (
        <div className="uga-card p-12 text-center text-sm text-muted-foreground">
          暂无同步记录
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const isOpen = expanded === item.id
            const results = item.results || []
            const failedResults = results.filter(r => !r.success || r.reviewStatus === 'rejected')
            const failedIds = failedResults.map(r => r.platform)

            return (
              <div key={item.id} className="uga-card overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatDate(item.startTime)} · {formatRelative(item.endTime || item.startTime)} ·{' '}
                      {results.length} 个平台
                      {failedResults.length ? ` · ${failedResults.length} 个未成功` : ' · 全部成功'}
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1">
                    {results.slice(0, 4).map(result => (
                      <ResultPill key={result.platform} result={result} />
                    ))}
                    {results.length > 4 && (
                      <span className="text-[11px] text-muted-foreground">+{results.length - 4}</span>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t bg-muted/20 px-4 py-3">
                    {results.length === 0 ? (
                      <div className="py-3 text-center text-xs text-muted-foreground">这次同步没有结果（可能中途关闭了浏览器）</div>
                    ) : (
                      <div className="divide-y">
                        {results.map(result => {
                          const meta = platformMeta(result.platform)
                          return (
                            <div key={result.platform} className="flex items-start gap-2 py-2 text-sm">
                              <PlatformIcon icon={meta?.icon} name={result.platformName || result.platform} size={16} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate">{result.platformName || meta?.name || result.platform}</span>
                                  <ResultPill result={result} />
                                  {reviewText(result.reviewStatus) && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {result.reviewStatusText || reviewText(result.reviewStatus)}
                                    </span>
                                  )}
                                </div>
                                {result.error && <div className="mt-0.5 text-xs text-red-500">{result.error}</div>}
                                {result.message && <div className="mt-0.5 text-xs text-muted-foreground">{result.message}</div>}
                              </div>
                              <div className="flex flex-shrink-0 gap-1">
                                {result.postUrl && (
                                  <a
                                    href={result.postUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="uga-btn-ghost px-2 py-1 text-xs"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" /> 打开
                                  </a>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                      <button
                        className="uga-btn-secondary px-2 py-1 text-xs"
                        onClick={() =>
                          setEditing({
                            syncId: item.id,
                            platforms: failedIds.length ? failedIds : results.map(r => r.platform),
                            draftOnly: results.every(r => r.draftOnly !== false),
                          })
                        }
                      >
                        <PencilLine className="h-3.5 w-3.5" /> 返回编辑
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <EditArticleModal
        open={!!editing}
        onClose={() => setEditing(null)}
        syncId={editing?.syncId}
        defaultPlatforms={editing?.platforms || []}
        defaultMode={editing?.draftOnly ? 'draft' : 'publish'}
      />
    </div>
  )
}

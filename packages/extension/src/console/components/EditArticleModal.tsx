import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { contentKind } from '../lib/format'
import { PlatformIcon, ResultPill } from './PlatformBadge'
import type { Article, SyncResult } from '../lib/types'

interface Props {
  open: boolean
  onClose: () => void
  /** 从哪次同步记录打开（用于取正文快照） */
  syncId?: string
  /** 直接给一篇文章（例如当前待同步文章） */
  initialArticle?: Article | null
  /** 默认勾选的目标平台 */
  defaultPlatforms: string[]
  defaultMode?: 'draft' | 'publish'
  heading?: string
}

/**
 * 返回编辑：修改标题/摘要/标签/正文后重新发布到指定平台
 */
export function EditArticleModal({
  open,
  onClose,
  syncId,
  initialArticle,
  defaultPlatforms,
  defaultMode = 'publish',
  heading = '返回编辑并重新发布',
}: Props) {
  const { platforms, loadSnapshot, runSync } = useConsoleStore()

  const [loading, setLoading] = useState(false)
  const [snapshotMissing, setSnapshotMissing] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown')
  const [targets, setTargets] = useState<string[]>([])
  const [mode, setMode] = useState<'draft' | 'publish'>(defaultMode)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<SyncResult[] | null>(null)
  const [cover, setCover] = useState<string | undefined>()
  const [sourceUrl, setSourceUrl] = useState<string | undefined>()

  // 打开时才读取 props 快照，避免父组件每次渲染传入新数组导致表单被重置
  const propsRef = useRef({ initialArticle, defaultPlatforms, defaultMode })
  propsRef.current = { initialArticle, defaultPlatforms, defaultMode }

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const { initialArticle: initial, defaultPlatforms: initialTargets, defaultMode: initialMode } = propsRef.current

    setResults(null)
    setRunning(false)
    setTargets(initialTargets)
    setMode(initialMode)

    const apply = (article: Article | null) => {
      if (cancelled) return
      setTitle(article?.title || '')
      setSummary(article?.summary || '')
      setTags((article?.tags || []).join(', '))
      setCover(article?.cover)
      setSourceUrl(article?.source?.url)
      setFormat(contentKind(article || {}))
      setBody(article?.markdown || article?.html || article?.content || '')
      setSnapshotMissing(!(article?.markdown || article?.html || article?.content))
    }

    if (initial) {
      apply(initial)
      return () => { cancelled = true }
    }

    if (!syncId) {
      apply(null)
      return () => { cancelled = true }
    }

    setLoading(true)
    loadSnapshot(syncId)
      .then(snapshot => apply(snapshot))
      .catch(() => apply(null))
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [open, syncId, loadSnapshot])

  if (!open) return null

  const authed = platforms.filter(p => p.isAuthenticated)

  const submit = async () => {
    if (!title.trim() || !body.trim() || !targets.length) return

    // 只保留当前格式的正文，避免旧字段覆盖新内容
    const article: Article = {
      title: title.trim(),
      summary: summary.trim() || undefined,
      tags: tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean),
      cover,
      source: sourceUrl ? { url: sourceUrl } : undefined,
      ...(format === 'markdown'
        ? { markdown: body, content: undefined, html: undefined }
        : { html: body, content: body, markdown: undefined }),
    }

    setRunning(true)
    setResults(null)
    const synced = await runSync(article, targets, { mode })
    setResults(synced)
    setRunning(false)
  }

  const toggleTarget = (id: string) => {
    setTargets(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm">
      <div className="my-6 w-full max-w-3xl rounded-xl border bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{heading}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              修改后可直接重发到指定平台，失败的原文会保留在同步记录里。
            </p>
          </div>
          <button className="uga-btn-ghost p-1" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在读取正文快照…
            </div>
          ) : (
            <>
              {snapshotMissing && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  没有找到这篇的正文快照（旧版本记录或快照已被淘汰）。可以把正文粘贴到下面再重发。
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">标题</label>
                <input className="uga-input" value={title} onChange={e => setTitle(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">摘要（可选）</label>
                  <input className="uga-input" value={summary} onChange={e => setSummary(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">标签（逗号分隔）</label>
                  <input className="uga-input" value={tags} onChange={e => setTags(e.target.value)} />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    正文 · {body.replace(/<[^>]+>/g, '').length} 字符
                  </label>
                  <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
                    {(['markdown', 'html'] as const).map(item => (
                      <button
                        key={item}
                        onClick={() => setFormat(item)}
                        className={`rounded-md px-2 py-0.5 ${format === item ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                      >
                        {item === 'markdown' ? 'Markdown' : 'HTML'}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  className="uga-input h-72 resize-y font-mono text-[12px] leading-relaxed"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder={format === 'markdown' ? '# 正文标题\n\n支持 Markdown' : '<h2>正文</h2>'}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">目标平台</label>
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {authed.map(platform => (
                      <label
                        key={platform.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
                      >
                        <input
                          type="checkbox"
                          checked={targets.includes(platform.id)}
                          onChange={() => toggleTarget(platform.id)}
                          className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                        />
                        <PlatformIcon icon={platform.icon} name={platform.name} size={16} />
                        <span className="truncate">{platform.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">发布方式</label>
                  <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-sm">
                    {(['publish', 'draft'] as const).map(item => (
                      <button
                        key={item}
                        onClick={() => setMode(item)}
                        className={`flex-1 rounded-md px-2 py-1 ${mode === item ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                      >
                        {item === 'publish' ? '立即发布' : '存为草稿'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    没有直发能力的平台会自动降级为草稿；已选 {targets.length} 个目标。
                  </p>
                </div>
              </div>

              {results && (
                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">本次重发结果</div>
                  <div className="divide-y">
                    {results.map(result => (
                      <div key={result.platform} className="flex items-start gap-2 px-3 py-2 text-sm">
                        <ResultPill result={result} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            {result.platformName || result.platform}
                            {result.message ? ` · ${result.message}` : ''}
                          </div>
                          {result.error && (
                            <div className="mt-0.5 text-xs text-red-500">{result.error}</div>
                          )}
                        </div>
                        {result.postUrl && (
                          <a
                            className="flex-shrink-0 text-xs text-primary hover:underline"
                            href={result.postUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            打开
                          </a>
                        )}
                      </div>
                    ))}
                    {results.length === 0 && (
                      <div className="px-3 py-3 text-xs text-muted-foreground">没有返回结果，请检查平台登录状态。</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            已选 {targets.length} 个平台
          </span>
          <div className="flex gap-2">
            <button className="uga-btn-secondary" onClick={onClose}>
              {results ? '关闭' : '取消'}
            </button>
            <button
              className="uga-btn-primary"
              onClick={submit}
              disabled={running || loading || !title.trim() || !body.trim() || targets.length === 0}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {running ? '发布中…' : '保存并重发'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

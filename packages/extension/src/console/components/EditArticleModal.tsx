import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Loader2, Save, Send, Square, Undo2, X } from 'lucide-react'
import type { DraftResult } from '@ugaeo/core'
import { useConsoleStore } from '../lib/store'
import { contentKind } from '../lib/format'
import { compressDataUrl } from '../lib/image'
import { AISettingsDialog } from './AISettingsDialog'
import { AiComposePanel } from './AiComposePanel'
import { PlatformIcon, ResultPill } from './PlatformBadge'
import { MarkdownEditor } from './MarkdownEditor'
import { splitPlatformsByMode, countUnauthenticated } from '../lib/publish-flow'
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
  /**
   * save：只编辑并保存，不校验必填、不发布（同步页用）
   * publish：改完直接重发（失败处理页用）
   */
  purpose?: 'save' | 'publish'
  /**
   * 内嵌到页面里而不是弹窗（AI 创作页用）
   *
   * 去掉遮罩与固定高度，让页面自己滚；关闭按钮也不显示 —— 内嵌时没有「关掉」
   * 这个概念，只有保存。
   */
  inline?: boolean
  /**
   * 外部切换要编辑的文章时递增
   *
   * 内嵌时 open 恒为 true，光改 initialArticle 不会触发重新载入（下面那个 effect
   * 依赖 open），所以给一个显式的重载信号。
   */
  resetKey?: string | number
  onSave?: (article: Article) => void
}

/**
 * 文章编辑器
 *
 * 两种用途共用一套界面：
 * - 同步页「手动新建 / 编辑」→ 只保存，内容可以只写一半，随时 Ctrl+S；
 * - 失败处理「返回编辑」→ 保存并重发到指定平台。
 *
 * 平台列表跟着发布方式走：立即发布列「可直发 + AI 自动发布」的平台，
 * 存为草稿列全部平台；词条平台（没有文章编辑器）只在草稿模式可选。
 */
export function EditArticleModal({
  open,
  onClose,
  syncId,
  initialArticle,
  defaultPlatforms,
  defaultMode = 'publish',
  heading,
  purpose = 'publish',
  inline = false,
  resetKey,
  onSave,
}: Props) {
  const { platforms, loadSnapshot, runSync, setNotice } = useConsoleStore()

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

  // AI 设置弹窗与「撤销 AI 生成」快照
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [aiFocus, setAiFocus] = useState<'text' | 'image'>('text')
  const [aiUndo, setAiUndo] = useState<{
    title: string
    summary: string
    tags: string
    body: string
    format: 'markdown' | 'html'
  } | null>(null)

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
    setAiUndo(null)
    setAiSettingsOpen(false)

    const apply = (article: Article | null) => {
      if (cancelled) return
      setTitle(article?.title || '')
      setSummary(article?.summary || '')
      setTags((article?.tags || []).join(', '))
      setCover(article?.cover)
      setSourceUrl(article?.source?.url)
      // 新建空白文章时默认 Markdown（写作场景更常用），有内容则按内容实际形态
      setFormat(article ? contentKind(article) : 'markdown')
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
  }, [open, syncId, loadSnapshot, resetKey])

  const { selectable, locked } = useMemo(() => splitPlatformsByMode(platforms, mode), [platforms, mode])
  const selectableKey = selectable.map(platform => platform.id).join(',')
  const unauthedSelected = countUnauthenticated(platforms, targets)

  // 切换发布方式后，把已经不符合条件的平台从选中里去掉
  useEffect(() => {
    if (!open) return
    const allowed = new Set(selectableKey ? selectableKey.split(',') : [])
    setTargets(prev => {
      const next = prev.filter(id => allowed.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [open, selectableKey])

  const allSelected = selectable.length > 0 && selectable.every(platform => targets.includes(platform.id))

  const buildArticle = (): Article => {
    const trimmedTitle = title.trim()
    const tagsArray = tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean)
    return {
      title: trimmedTitle,
      summary: summary.trim() || undefined,
      tags: tagsArray.length ? tagsArray : undefined,
      cover,
      source: sourceUrl ? { url: sourceUrl } : undefined,
      // 只留当前格式的正文，避免旧字段盖掉新内容
      ...(format === 'markdown'
        ? { markdown: body, content: undefined, html: undefined }
        : { html: body, content: body, markdown: undefined }),
    }
  }

  const handleSave = () => {
    const article = buildArticle()
    onSave?.(article)
    setNotice({ kind: 'ok', text: article.title ? `已保存《${article.title}》` : '已保存草稿内容' })
    onClose()
  }

  /** 应用 AI 生成的整篇稿：先把当前内容存快照，用户不满意可以一键退回 */
  const applyDraft = (draft: DraftResult) => {
    setAiUndo({ title, summary, tags, body, format })
    setTitle(draft.title || title)
    setSummary(draft.summary || '')
    if (draft.tags?.length) setTags(draft.tags.join(', '))
    setFormat('markdown')
    setBody(draft.markdown)
    setSnapshotMissing(false)
  }

  const undoDraft = () => {
    if (!aiUndo) return
    setTitle(aiUndo.title)
    setSummary(aiUndo.summary)
    setTags(aiUndo.tags)
    setBody(aiUndo.body)
    setFormat(aiUndo.format)
    setAiUndo(null)
    setNotice({ kind: 'info', text: '已撤销 AI 生成，内容退回生成前' })
  }

  /** 把生成的配图插到正文末尾（按当前格式写 Markdown / HTML） */
  const insertImage = (dataUrl: string) => {
    void (async () => {
      const src = await compressDataUrl(dataUrl)
      setBody(prev => {
        const snippet =
          format === 'markdown'
            ? `\n\n![AI 配图](${src})\n`
            : `\n<p><img src="${src}" alt="AI 配图" /></p>`
        return prev.trim() ? `${prev.trimEnd()}${snippet}` : snippet.trimStart()
      })
      setSnapshotMissing(false)
    })()
  }

  useEffect(() => {
    if (!open || purpose !== 'save') return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!open) return null

  const submit = async () => {
    if (!title.trim() || !body.trim() || !targets.length) return

    const article = buildArticle()
    setRunning(true)
    setResults(null)
    const synced = await runSync(article, targets, { mode })
    setResults(synced)
    setRunning(false)
  }

  const toggleTarget = (id: string) => {
    setTargets(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const isSaveMode = purpose === 'save'
  const titleText = heading || (isSaveMode ? '编辑文章' : '返回编辑并重新发布')

  const panel = (
    <div
      className={
        inline
          ? 'w-full rounded-xl border bg-card'
          : 'my-6 w-full max-w-3xl rounded-xl border bg-card shadow-2xl'
      }
    >
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{titleText}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isSaveMode
              ? '内容可以先写一半，随时保存；发布方式与平台可以之后再选。'
              : '修改后可直接重发到指定平台，失败的原文会保留在同步记录里。'}
          </p>
        </div>
        {!inline && (
          <button className="uga-btn-ghost p-1" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className={inline ? 'space-y-4 px-5 py-4' : 'max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4'}>
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在读取正文快照…
            </div>
          ) : (
            <>
              {snapshotMissing && !isSaveMode && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  没有找到这篇的正文快照（旧版本记录或快照已被淘汰）。可以把正文粘贴到下面再重发。
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">标题</label>
                <input
                  className="uga-input"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="先写个标题，之后再改也行"
                />
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
                  <label className="block text-xs font-medium text-muted-foreground">正文</label>
                  {aiUndo && (
                    <button
                      type="button"
                      onClick={undoDraft}
                      className="uga-btn-ghost flex items-center gap-1 px-1.5 py-0.5 text-[11px]"
                      title="退回 AI 生成前的内容"
                    >
                      <Undo2 className="h-3 w-3" />
                      撤销 AI 生成
                    </button>
                  )}
                </div>

                <div className="mb-2">
                  <AiComposePanel
                    title={title}
                    hasBody={body.trim().length > 0}
                    onApplyDraft={applyDraft}
                    onInsertImage={insertImage}
                    onSetCover={dataUrl => {
                      void compressDataUrl(dataUrl).then(setCover)
                    }}
                    onOpenSettings={focus => {
                      setAiFocus(focus)
                      setAiSettingsOpen(true)
                    }}
                    onNotice={(text, kind) => setNotice({ kind: kind ?? 'info', text })}
                  />
                </div>

                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  format={format}
                  onFormatChange={setFormat}
                  heightClass="h-80"
                  placeholder={
                    format === 'markdown'
                      ? '# 从这里开始写\n\n支持 Markdown，工具栏按钮即可插入格式，图片可以直接粘贴进来。'
                      : '<h2>正文</h2>\n<p>支持 HTML，图片可以直接粘贴进来。</p>'
                  }
                  onImageError={message => setNotice({ kind: 'error', text: `图片处理失败：${message}` })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      目标平台
                      <span className="ml-1 font-normal">
                        {mode === 'publish' ? '（可自动发布：直发 + AI）' : '（全部平台）'} {selectable.length} 个
                      </span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="uga-btn-ghost px-1.5 py-0.5 text-[11px]"
                        onClick={() => setTargets(selectable.map(platform => platform.id))}
                        disabled={!selectable.length}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="uga-btn-ghost px-1.5 py-0.5 text-[11px]"
                        onClick={() => {
                          setTargets([])
                          setNotice({ kind: 'info', text: '已清空目标平台' })
                        }}
                        disabled={!targets.length}
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                    {selectable.length === 0 && (
                      <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                        {mode === 'publish'
                          ? '还没有支持自动发布的已登录平台，可以先存着，或切到「存为草稿」。'
                          : '没有读取到平台列表，请打开扩展弹窗刷新一次。'}
                      </p>
                    )}
                    {selectable.map(platform => {
                      const checked = targets.includes(platform.id)
                      return (
                        <label
                          key={platform.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTarget(platform.id)}
                            className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                          />
                          <PlatformIcon platformId={platform.id} icon={platform.icon} name={platform.name} size={16} />
                          <span className="truncate">{platform.name}</span>
                          {!platform.isAuthenticated && (
                            <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">
                              {platform.needsProbe ? '待检测' : '未登录'}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>

                  {mode === 'publish' && locked.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      另有 {locked.length} 个词条平台（没有文章编辑器）只能存草稿，切到「存为草稿」可选。
                    </p>
                  )}
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

                  <button
                    type="button"
                    onClick={() =>
                      allSelected ? setTargets([]) : setTargets(selectable.map(platform => platform.id))
                    }
                    disabled={!selectable.length}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    {allSelected ? '取消全选' : '全选当前列表'}
                  </button>

                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {mode === 'publish'
                      ? '只列出「已登录 + 能自动发布」的平台；词条平台没有文章编辑器，切到「存为草稿」再选。'
                      : '全部平台都能收草稿；标「未登录」的同步前要先登录，发布仍需到平台后台点一下。'}
                    <br />
                    已选 {targets.length} 个目标
                    {unauthedSelected > 0 ? ` · 其中 ${unauthedSelected} 个未登录` : ''}。
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
          {isSaveMode
            ? `已选 ${targets.length} 个平台 · 不必填全也能保存`
            : `已选 ${targets.length} 个平台`}
        </span>
        <div className="flex gap-2">
          {!inline && (
            <button className="uga-btn-secondary" onClick={onClose}>
              {results && !isSaveMode ? '关闭' : '取消'}
            </button>
          )}
          {isSaveMode ? (
            <button className="uga-btn-primary" onClick={handleSave} disabled={loading}>
              <Save className="h-4 w-4" />
              保存
            </button>
          ) : (
            <button
              className="uga-btn-primary"
              onClick={submit}
              disabled={running || loading || !title.trim() || !body.trim() || targets.length === 0}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {running ? '发布中…' : '保存并重发'}
            </button>
          )}
        </div>
      </footer>
    </div>
  )

  return (
    <>
      {inline ? (
        panel
      ) : (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm">
          {panel}
        </div>
      )}

      <AISettingsDialog
        open={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
        focus={aiFocus}
      />
    </>
  )
}

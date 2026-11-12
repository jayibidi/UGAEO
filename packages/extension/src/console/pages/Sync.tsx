import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  FileText,
  Loader2,
  PencilLine,
  RefreshCw,
  Send,
  RotateCcw,
  Link2,
} from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformPicker } from '../components/PlatformPicker'
import { PlatformIcon, ResultPill } from '../components/PlatformBadge'
import { EditArticleModal } from '../components/EditArticleModal'
import { STAGE_TEXT, formatRelative, wordCount } from '../lib/format'

export function SyncPage() {
  const {
    article,
    platforms,
    selectedPlatforms,
    publishMode,
    sync,
    setPublishMode,
    setArticle,
    extractFromActiveTab,
    startSync,
    runSync,
    setNotice,
    history,
  } = useConsoleStore()

  const [editing, setEditing] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualBody, setManualBody] = useState('')

  const failed = sync.results.filter(result => !result.success)
  const totalStages = Object.keys(sync.stages).length
  const doneStages = Object.values(sync.stages).filter(stage => stage.stage === 'completed' || stage.stage === 'failed').length
  const progressPercent = selectedPlatforms.length
    ? Math.round((Math.max(doneStages, sync.results.length) / selectedPlatforms.length) * 100)
    : 0

  const platformName = (id: string) => platforms.find(p => p.id === id)?.name || id
  const platformIcon = (id: string) => platforms.find(p => p.id === id)?.icon

  const saveManual = () => {
    if (!manualTitle.trim() || !manualBody.trim()) return
    setArticle({ title: manualTitle.trim(), markdown: manualBody })
    setManualTitle('')
    setManualBody('')
    setManualOpen(false)
    setNotice({ kind: 'ok', text: '已创建待同步文章' })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        {/* 文章 */}
        <section className="uga-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">待同步文章</h2>
            <div className="flex gap-1">
              <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={() => extractFromActiveTab()}>
                <RefreshCw className="h-3.5 w-3.5" /> 从当前页面提取
              </button>
              <button
                className="uga-btn-ghost px-2 py-1 text-xs"
                onClick={() => setManualOpen(open => !open)}
              >
                <FileText className="h-3.5 w-3.5" /> 手动新建
              </button>
            </div>
          </div>

          {manualOpen && (
            <div className="mb-4 space-y-2 rounded-lg border border-dashed p-3">
              <input
                className="uga-input"
                placeholder="文章标题"
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
              />
              <textarea
                className="uga-input h-40 resize-y font-mono text-[12px]"
                placeholder="正文（Markdown）"
                value={manualBody}
                onChange={e => setManualBody(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button className="uga-btn-secondary" onClick={() => setManualOpen(false)}>
                  取消
                </button>
                <button className="uga-btn-primary" onClick={saveManual} disabled={!manualTitle.trim() || !manualBody.trim()}>
                  使用这篇
                </button>
              </div>
            </div>
          )}

          {article ? (
            <div className="flex gap-4">
              {article.cover ? (
                <img src={article.cover} alt="" className="h-20 w-32 flex-shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-sm font-medium">{article.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {wordCount(article)} 字
                  {article.tags?.length ? ` · ${article.tags.join(' / ')}` : ''}
                  {article.platformContents ? ' · 含平台专属版本' : ''}
                </p>
                {article.source?.url && (
                  <a
                    href={article.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 truncate text-xs text-primary hover:underline"
                  >
                    <Link2 className="h-3 w-3" /> 原文
                  </a>
                )}
                <div className="mt-2 flex gap-1">
                  <button className="uga-btn-secondary px-2 py-1 text-xs" onClick={() => setEditing(true)}>
                    <PencilLine className="h-3.5 w-3.5" /> 编辑后发布
                  </button>
                  <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={() => setArticle(null)}>
                    清空
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">还没有待同步文章</p>
              <p className="mt-1 text-xs text-muted-foreground">
                打开任意文章页点上面的「从当前页面提取」，或手动粘贴正文
              </p>
            </div>
          )}
        </section>

        {/* 平台 */}
        <section className="uga-card p-5">
          <h2 className="mb-3 text-sm font-medium">目标平台</h2>
          <PlatformPicker />
        </section>
      </div>

      {/* 右侧操作栏 */}
      <div className="space-y-4">
        <section className="uga-card sticky top-4 p-5">
          <h2 className="mb-3 text-sm font-medium">发布设置</h2>

          <div className="mb-3 flex gap-1 rounded-lg bg-muted p-0.5 text-sm">
            {(['draft', 'publish'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setPublishMode(mode)}
                className={`flex-1 rounded-md px-2 py-1.5 ${
                  publishMode === mode ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {mode === 'draft' ? '存为草稿' : '立即发布'}
              </button>
            ))}
          </div>
          <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
            未声明直发能力的平台会自动降级为草稿并在结果中标注；定时发布请到扩展弹窗的设置里配置。
          </p>

          <button
            className="uga-btn-primary w-full"
            disabled={sync.running || !article || selectedPlatforms.length === 0}
            onClick={() => startSync()}
          >
            {sync.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sync.running ? '同步中…' : `同步到 ${selectedPlatforms.length} 个平台`}
          </button>

          {sync.running && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>
                  {sync.results.length}/{selectedPlatforms.length} 已完成
                </span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}

          {sync.error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
              {sync.error}
            </div>
          )}

          {!sync.running && sync.results.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">本次结果</span>
                <span className="text-muted-foreground">
                  {sync.results.length - failed.length} 成功 / {failed.length} 失败
                </span>
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto">
                {sync.results.map(result => (
                  <div key={result.platform} className="flex items-start gap-2 rounded-md px-1 py-1.5 text-xs">
                    <PlatformIcon icon={platformIcon(result.platform)} name={platformName(result.platform)} size={14} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{result.platformName || platformName(result.platform)}</span>
                        <ResultPill result={result} />
                      </div>
                      {result.error && <div className="mt-0.5 line-clamp-2 text-red-500">{result.error}</div>}
                      {result.message && !result.error && (
                        <div className="mt-0.5 line-clamp-2 text-muted-foreground">{result.message}</div>
                      )}
                    </div>
                    {result.postUrl && (
                      <a
                        href={result.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 text-primary hover:underline"
                      >
                        打开
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {failed.length > 0 && (
                <div className="flex gap-1 pt-1">
                  <button
                    className="uga-btn-secondary flex-1 px-2 py-1 text-xs"
                    disabled={!article}
                    onClick={() => article && runSync(article, failed.map(item => item.platform))}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> 重试失败项
                  </button>
                  <Link to="/failures" className="uga-btn-ghost px-2 py-1 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" /> 处理
                  </Link>
                </div>
              )}
            </div>
          )}

          {totalStages > 0 && sync.running && (
            <div className="mt-4 space-y-1 border-t pt-3 text-[11px] text-muted-foreground">
              {Object.values(sync.stages).map(stage => (
                <div key={stage.platform} className="flex items-center justify-between">
                  <span className="truncate">{stage.platformName || platformName(stage.platform)}</span>
                  <span>{STAGE_TEXT[stage.stage] || stage.stage}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="uga-card p-5 text-xs text-muted-foreground">
          <h2 className="mb-2 text-sm font-medium text-foreground">上次同步</h2>
          {history[0] ? (
            <div className="space-y-1">
              <div className="truncate text-foreground">{history[0].title}</div>
              <div>{formatRelative(history[0].endTime || history[0].startTime)}</div>
              <Link to="/history" className="inline-block text-primary hover:underline">
                查看明细
              </Link>
            </div>
          ) : (
            <div>还没有同步记录</div>
          )}
        </section>
      </div>

      <EditArticleModal
        open={editing}
        onClose={() => setEditing(false)}
        initialArticle={article}
        defaultPlatforms={selectedPlatforms}
        defaultMode={publishMode}
        heading="编辑文章并发布"
      />
    </div>
  )
}

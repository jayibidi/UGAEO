import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Link2, PencilLine, RefreshCw } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformPicker } from '../components/PlatformPicker'
import { PublishSettings } from '../components/PublishSettings'
import { EditArticleModal } from '../components/EditArticleModal'
import { formatRelative, wordCount } from '../lib/format'

export function SyncPage() {
  const {
    article,
    publishMode,
    draftRefs,
    selectedPlatforms,
    setArticle,
    extractFromActiveTab,
    history,
  } = useConsoleStore()

  const [editing, setEditing] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualBody, setManualBody] = useState('')

  const publishingDrafts = publishMode === 'publish' && draftRefs.length > 0

  const saveManual = () => {
    if (!manualTitle.trim() || !manualBody.trim()) return
    setArticle({ title: manualTitle.trim(), markdown: manualBody })
    setManualTitle('')
    setManualBody('')
    setManualOpen(false)
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">目标平台</h2>
            <span className="text-[11px] text-muted-foreground">
              {publishMode === 'draft' ? '全部平台只存草稿' : '仅显示可直发平台'}
            </span>
          </div>

          {publishingDrafts ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm">本次发布对象是已带入的 {draftRefs.length} 篇草稿</p>
              <p className="mt-1 text-xs text-muted-foreground">
                不需要重新选平台。想改成「新文章直接发布」，点右侧的「改为发布新文章」。
              </p>
            </div>
          ) : (
            <PlatformPicker />
          )}
        </section>
      </div>

      {/* 右侧操作栏 */}
      <div className="space-y-4">
        <PublishSettings />

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

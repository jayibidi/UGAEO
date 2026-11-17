import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Feather, FilePlus2, FileText, Link2, Loader2, PencilLine, RefreshCw } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformPicker } from '../components/PlatformPicker'
import { PublishSettings } from '../components/PublishSettings'
import { EditArticleModal } from '../components/EditArticleModal'
import { formatRelative, wordCount } from '../lib/format'
import type { Article } from '../lib/types'

export function SyncPage() {
  const {
    article,
    publishMode,
    draftRefs,
    selectedPlatforms,
    setArticle,
    extractFromActiveTab,
    feishuCapture,
    startFeishuCapture,
    cancelFeishuCapture,
    history,
  } = useConsoleStore()

  // 编辑弹窗：seed 为 null 表示「手动新建」，否则是在改当前这篇
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSeed, setEditorSeed] = useState<Article | null>(null)

  const publishingDrafts = publishMode === 'publish' && draftRefs.length > 0

  const openEditor = (seed: Article | null) => {
    setEditorSeed(seed)
    setEditorOpen(true)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        {/* 文章 */}
        <section className="uga-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">待同步文章</h2>
            <div className="flex gap-1.5">
              <button
                className="uga-btn-secondary px-2.5 py-1 text-xs"
                onClick={() => startFeishuCapture()}
                title="打开飞书云文档，在飞书里编好图文，回到这里就自动带过来"
              >
                <Feather className="h-3.5 w-3.5" /> 从飞书文档中提取
              </button>
              <button
                className="uga-btn-secondary px-2.5 py-1 text-xs"
                onClick={() => extractFromActiveTab()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> 从当前页面提取
              </button>
              <button className="uga-btn-secondary px-2.5 py-1 text-xs" onClick={() => openEditor(null)}>
                <FilePlus2 className="h-3.5 w-3.5" /> 手动新建
              </button>
            </div>
          </div>

          {feishuCapture.status === 'waiting' && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">正在等待飞书文档</p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  已打开飞书云文档。在飞书里打开任意文档，正文与图片会自动提取到这里（30 分钟内有效）。
                </p>
              </div>
              <button
                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => cancelFeishuCapture()}
              >
                取消
              </button>
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
                <h3 className="line-clamp-2 text-sm font-medium">{article.title || '（未命名草稿）'}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {wordCount(article)} 字
                  {article.imageCount ? ` · ${article.imageCount} 张图` : ''}
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
                  <button
                    className="uga-btn-secondary px-2 py-1 text-xs"
                    onClick={() => openEditor(article)}
                  >
                    <PencilLine className="h-3.5 w-3.5" /> 编辑
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
                打开任意文章页点「从当前页面提取」、在页面上右键选「同步助手 - 提取与编辑文章」，或点「手动新建」
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
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initialArticle={editorSeed}
        defaultPlatforms={selectedPlatforms}
        defaultMode={publishMode}
        purpose="save"
        heading={editorSeed ? '编辑文章' : '手动新建文章'}
        onSave={next => setArticle(next)}
      />
    </div>
  )
}

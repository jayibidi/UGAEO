import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Feather,
  FilePlus2,
  FileText,
  Link2,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { AIModelSettings } from '../components/AIModelSettings'
import { EditArticleModal } from '../components/EditArticleModal'
import { wordCount } from '../lib/format'
import type { Article } from '../lib/types'

/**
 * AI 创作
 *
 * 这一页承担两件事：
 * 1. 待同步文章的管理（从飞书 / 当前页提取、手动新建）—— 原来是同步页里的一个卡片，
 *    现在提到一级菜单，因为「写作」和「选平台发布」是两件事；
 * 2. 常驻的文章编辑器 + AI 模型配置 —— 手动新建原来是弹窗，现在直接在页面里，
 *    写完就能存，不用反复开关弹窗。
 *
 * 真正的发布动作仍在「同步」页：那边选平台、选发布方式、看结果。
 */
export function ComposePage() {
  const {
    article,
    selectedPlatforms,
    publishMode,
    setArticle,
    extractFromActiveTab,
    feishuCapture,
    startFeishuCapture,
    cancelFeishuCapture,
  } = useConsoleStore()

  /** 递增即让编辑器重新读取 initialArticle；内嵌时没有 open 变化可用 */
  const [editorKey, setEditorKey] = useState(0)
  const [editorSeed, setEditorSeed] = useState<Article | null>(article)
  const [extracting, setExtracting] = useState(false)

  const loadIntoEditor = (seed: Article | null) => {
    setEditorSeed(seed)
    setEditorKey(k => k + 1)
  }

  /**
   * 首次拿到文章时自动填进编辑器
   *
   * 刷新页面时 store 里的文章是 boot() 异步从 storage 取回来的：首帧 article 还是
   * null，编辑器会停成空白，用户看到上面卡片有文章、下面却是空的。这里只在
   * 「第一次从无到有」时补一次，之后一律等用户点「载入编辑器」——否则用户正在
   * 写新稿时旧文章恢复过来会把内容盖掉。
   */
  const autoLoadedRef = useRef(false)
  useEffect(() => {
    if (autoLoadedRef.current || !article) return
    autoLoadedRef.current = true
    loadIntoEditor(article)
  }, [article])

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const ok = await extractFromActiveTab()
      if (ok) {
        // 取完直接填进编辑器：用户点这个按钮就是为了编辑刚抓到的内容
        const latest = useConsoleStore.getState().article
        if (latest) loadIntoEditor(latest)
      }
    } finally {
      setExtracting(false)
    }
  }

  const feishuWaiting = feishuCapture.status === 'waiting'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        {/* 待同步文章 */}
        <section className="uga-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">待同步文章</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                写完存在这里，到「同步」页选平台发布
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                className="uga-btn-secondary px-2.5 py-1 text-xs"
                onClick={() => startFeishuCapture()}
                disabled={feishuWaiting}
                title="打开飞书云文档，在飞书里编好图文，回到这里就自动带过来"
              >
                <Feather className="h-3.5 w-3.5" /> 从飞书文档提取
              </button>
              <button
                className="uga-btn-secondary px-2.5 py-1 text-xs"
                onClick={() => void handleExtract()}
                disabled={extracting}
              >
                {extracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                从当前页面提取
              </button>
              <button className="uga-btn-secondary px-2.5 py-1 text-xs" onClick={() => loadIntoEditor(null)}>
                <FilePlus2 className="h-3.5 w-3.5" /> 新建空白
              </button>
            </div>
          </div>

          {feishuWaiting && (
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
                    className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
                  >
                    <Link2 className="h-3 w-3 flex-shrink-0" /> 原文
                  </a>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    className="uga-btn-secondary px-2 py-1 text-xs"
                    onClick={() => loadIntoEditor(article)}
                  >
                    <PenLine className="h-3.5 w-3.5" /> 载入编辑器
                  </button>
                  <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={() => setArticle(null)}>
                    清空
                  </button>
                  <Link
                    to="/sync"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    <Send className="h-3.5 w-3.5" />
                    去发布
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">还没有待同步文章</p>
              <p className="mt-1 text-xs text-muted-foreground">
                直接在下面写，或用「从当前页面提取」抓取正在看的文章、用「从飞书文档提取」搬运飞书里的图文
              </p>
            </div>
          )}
        </section>

        {/* 编辑器常驻在页面里 */}
        <EditArticleModal
          inline
          open
          resetKey={editorKey}
          initialArticle={editorSeed}
          defaultPlatforms={selectedPlatforms}
          defaultMode={publishMode}
          purpose="save"
          heading="编辑器"
          onSave={next => setArticle(next)}
          onClose={() => {}}
        />
      </div>

      {/* 右侧：AI 模型（与设置页同一份配置） */}
      <div className="space-y-4">
        <section className="uga-card p-5">
          <div className="mb-3">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-violet-500" />
              AI 模型
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              接入中转站后，编辑器里的「AI 文案 / AI 配图」与「AI 对话」都走这里的模型，
              和「设置 → 发布与智能 → AI 模型」是同一份配置
            </p>
          </div>
          <AIModelSettings />
        </section>

        <section className="uga-card p-5 text-xs text-muted-foreground">
          <h2 className="mb-2 text-sm font-medium text-foreground">小提示</h2>
          <ul className="space-y-1.5 leading-relaxed">
            <li>· 正文支持 Markdown，图片可直接粘贴，会自动转成内联 dataURL</li>
            <li>· 编辑器里按 Ctrl+S 保存，不必点底部按钮</li>
            <li>· AI 生成的内容会先存快照，点「撤销 AI 生成」可退回</li>
            <li>· 保存后到「同步」页选平台，可直发的会直接点发布</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

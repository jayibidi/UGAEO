import { Link } from 'react-router-dom'
import { FileText, Link2, PenLine, Send } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformPicker } from '../components/PlatformPicker'
import { PublishSettings } from '../components/PublishSettings'
import { formatRelative, wordCount } from '../lib/format'

/**
 * 同步
 *
 * 这一页只做「选平台 + 发布」。
 * 写文章、提取内容、AI 生成都搬到了「AI 创作」页（一级菜单），
 * 这里只保留一个当前文章的摘要条，随时能跳回去改。
 */
export function SyncPage() {
  const { article, publishMode, draftRefs, history } = useConsoleStore()

  const publishingDrafts = publishMode === 'publish' && draftRefs.length > 0

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-6">
        {/* 当前文章：只读摘要 + 去编辑 */}
        <section className="uga-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">本次发布</h2>
            <Link
              to="/compose"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <PenLine className="h-3 w-3" />
              去 AI 创作编辑
            </Link>
          </div>

          {article ? (
            <div className="flex items-center gap-4">
              {article.cover ? (
                <img
                  src={article.cover}
                  alt=""
                  className="h-14 w-[5.5rem] flex-shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-14 w-[5.5rem] flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-1 text-sm font-medium">{article.title || '（未命名草稿）'}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {wordCount(article)} 字
                  {article.imageCount ? ` · ${article.imageCount} 张图` : ''}
                  {article.tags?.length ? ` · ${article.tags.join(' / ')}` : ''}
                </p>
                {article.source?.url && (
                  <a
                    href={article.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-primary hover:underline"
                  >
                    <Link2 className="h-3 w-3 flex-shrink-0" /> 原文
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-4 py-6">
              <div>
                <p className="text-sm text-muted-foreground">还没有待同步文章</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  到「AI 创作」写一篇，或用 AI 对话生成后贴进去
                </p>
              </div>
              <Link
                to="/compose"
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <PenLine className="h-3.5 w-3.5" />
                去创作
              </Link>
            </div>
          )}
        </section>

        {/* 平台 */}
        <section className="uga-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">目标平台</h2>
            <span className="text-[11px] text-muted-foreground">
              {publishMode === 'draft' ? '全部平台只存草稿' : '可直发 + AI 自动发布，词条平台需人工'}
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

        <section className="uga-card p-4">
          <Link
            to="/ai-chat"
            className="flex items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="leading-relaxed">还不知道写什么？让 AI 帮你定选题</span>
            <Send className="h-3.5 w-3.5 flex-shrink-0" />
          </Link>
        </section>
      </div>
    </div>
  )
}

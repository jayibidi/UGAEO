import { useState } from 'react'
import { Sparkles, Loader2, Check, Wand2, Tags, AlignLeft, Languages, Feather, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Article, Platform } from './types'

interface AIPanelProps {
  article: Article | null
  platforms: Platform[]
  selectedPlatforms: string[]
  aiReady: boolean
  onUpdateArticle?: (patch: Partial<Article>) => void
}

type TaskKey = 'title' | 'summary' | 'tags' | 'adapt' | 'rewrite'

/** 正文加工模式（与 core 的 RewriteMode 一致） */
type RewriteMode = 'polish' | 'expand' | 'condense'

const REWRITE_ACTIONS: Array<{
  mode: RewriteMode
  label: string
  icon: React.ReactNode
  desc: string
}> = [
  { mode: 'polish', label: '润色', icon: <Feather className="w-3 h-3" />, desc: '去口水话、理顺表达' },
  { mode: 'expand', label: '扩写', icon: <Maximize2 className="w-3 h-3" />, desc: '补充背景与解释' },
  { mode: 'condense', label: '精简', icon: <Minimize2 className="w-3 h-3" />, desc: '压到原文一半左右' },
]

interface AIResponse<T> {
  ok?: boolean
  data?: T
  error?: string
}

async function callAI<T>(payload: Record<string, unknown>): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    type: 'AI_TASK',
    payload,
  })) as AIResponse<T>
  if (!response?.ok) {
    throw new Error(response?.error || 'AI 请求失败')
  }
  return response.data as T
}

/**
 * AI 助手面板
 *
 * 在同步前对文章做标题优化、摘要、标签推荐、多平台风格适配。
 * 所有请求都经由 background 转发，API Key 不会暴露到页面上下文。
 */
export function AIPanel({
  article,
  platforms,
  selectedPlatforms,
  aiReady,
  onUpdateArticle,
}: AIPanelProps) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<TaskKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [titles, setTitles] = useState<string[]>([])
  const [summary, setSummary] = useState<string>('')
  const [tags, setTags] = useState<string[]>([])
  const [adaptNote, setAdaptNote] = useState<string>('')
  const [rewriteMode, setRewriteMode] = useState<RewriteMode | null>(null)
  const [rewriteResult, setRewriteResult] = useState<string>('')

  if (!article) return null

  const platformNameMap = new Map(platforms.map(p => [p.id, p.name]))
  const adaptedCount = Object.keys(article.platformContents || {}).length

  const sourceText = article.markdown || article.content || ''

  const run = async (task: TaskKey, mode?: RewriteMode) => {
    setRunning(task)
    setError(null)
    if (task === 'rewrite') {
      setRewriteMode(mode || 'polish')
      setRewriteResult('')
    }
    try {
      if (task === 'title') {
        const result = await callAI<string[]>({
          type: 'title',
          title: article.title,
          platform: platformNameMap.get(selectedPlatforms[0]) || '多平台',
        })
        setTitles(result || [])
      } else if (task === 'summary') {
        const result = await callAI<string>({ type: 'summary', content: sourceText, maxLength: 120 })
        setSummary(result || '')
      } else if (task === 'tags') {
        const result = await callAI<string[]>({
          type: 'tags',
          content: sourceText,
          platform: platformNameMap.get(selectedPlatforms[0]) || '多平台',
        })
        setTags(result || [])
      } else if (task === 'rewrite') {
        const rewritten = await callAI<string>({
          type: 'rewrite',
          content: sourceText,
          mode: mode || 'polish',
          title: article.title,
        })
        setRewriteResult(rewritten || '')
      } else {
        if (selectedPlatforms.length === 0) {
          throw new Error('请先选择要适配的平台')
        }
        const next: Record<string, { html: string; markdown: string }> = { ...(article.platformContents || {}) }
        let done = 0
        for (const pid of selectedPlatforms) {
          const markdown = await callAI<string>({
            type: 'adapt',
            content: sourceText,
            title: article.title,
            targetPlatform: pid,
            targetPlatformName: platformNameMap.get(pid) || pid,
          })
          if (markdown?.trim()) {
            next[pid] = { html: '', markdown }
            done++
          }
        }
        onUpdateArticle?.({ platformContents: next })
        setAdaptNote(`已为 ${done} 个平台生成差异化版本，同步时将优先使用`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const applyTitle = (t: string) => {
    onUpdateArticle?.({ title: t })
    setTitles([])
  }

  const applySummary = () => {
    onUpdateArticle?.({ summary })
    setSummary('')
  }

  /**
   * 采用加工后的正文
   *
   * 正文变了之后，之前针对旧正文做过的平台适配就过期了，一并清空，
   * 否则同步时仍会用回旧内容（platformContents 优先级更高）。
   */
  const applyRewrite = () => {
    if (!rewriteResult.trim()) return
    onUpdateArticle?.({
      markdown: rewriteResult,
      content: '',
      html: '',
      platformContents: {},
    })
    setRewriteResult('')
    setAdaptNote('已采用 AI 加工后的正文，原有平台适配已清空，可重新适配')
  }

  const toggleTag = (tag: string) => {
    const current = new Set(article.tags || [])
    if (current.has(tag)) current.delete(tag)
    else current.add(tag)
    onUpdateArticle?.({ tags: Array.from(current) })
  }

  return (
    <div className="rounded-lg border bg-gradient-to-br from-violet-50/60 to-blue-50/40 dark:from-violet-950/20 dark:to-blue-950/10">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Sparkles className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        <span className="text-xs font-medium flex-1">AI 助手</span>
        {adaptedCount > 0 && (
          <span className="text-[10px] text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/40 rounded px-1.5 py-0.5">
            已适配 {adaptedCount}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {aiReady ? (open ? '收起' : '展开') : '未配置'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {!aiReady ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              请先在「设置 → AI 模型」中填入中转站地址与 API Key，即可在同步前优化标题、摘要、标签，做润色/扩写/精简，并按平台风格改写内容。
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <ActionButton
                  icon={<Wand2 className="w-3 h-3" />}
                  label="优化标题"
                  loading={running === 'title'}
                  disabled={running !== null}
                  onClick={() => run('title')}
                />
                <ActionButton
                  icon={<AlignLeft className="w-3 h-3" />}
                  label="生成摘要"
                  loading={running === 'summary'}
                  disabled={running !== null}
                  onClick={() => run('summary')}
                />
                <ActionButton
                  icon={<Tags className="w-3 h-3" />}
                  label="推荐标签"
                  loading={running === 'tags'}
                  disabled={running !== null}
                  onClick={() => run('tags')}
                />
                <ActionButton
                  icon={<Languages className="w-3 h-3" />}
                  label={`适配 ${selectedPlatforms.length || ''} 个平台`}
                  loading={running === 'adapt'}
                  disabled={running !== null || selectedPlatforms.length === 0}
                  onClick={() => run('adapt')}
                />
              </div>

              <div>
                <p className="text-[10px] text-muted-foreground mb-1">正文加工（可回填为待同步正文）</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {REWRITE_ACTIONS.map(action => (
                    <ActionButton
                      key={action.mode}
                      icon={action.icon}
                      label={action.label}
                      loading={running === 'rewrite' && rewriteMode === action.mode}
                      disabled={running !== null}
                      onClick={() => run('rewrite', action.mode)}
                    />
                  ))}
                </div>
              </div>

              {running === 'rewrite' && (
                <p className="text-[11px] text-muted-foreground">
                  正在对全文做「{REWRITE_ACTIONS.find(a => a.mode === rewriteMode)?.label}」，
                  长文耗时较久，请勿关闭弹窗…
                </p>
              )}

              {rewriteResult && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground">
                      加工结果（{REWRITE_ACTIONS.find(a => a.mode === rewriteMode)?.label}）
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {sourceText.length} → {rewriteResult.length} 字
                    </span>
                  </div>
                  <div className="max-h-28 overflow-y-auto text-[11px] leading-relaxed bg-background/80 rounded p-2 whitespace-pre-wrap">
                    {rewriteResult.slice(0, 600)}
                    {rewriteResult.length > 600 ? '…' : ''}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={applyRewrite}
                      className="text-[10px] px-2 py-1 rounded bg-violet-500 text-white hover:bg-violet-600"
                    >
                      采用为正文
                    </button>
                    <button
                      onClick={() => setRewriteResult('')}
                      className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/70"
                    >
                      忽略
                    </button>
                  </div>
                </div>
              )}

              {running === 'adapt' && (
                <p className="text-[11px] text-muted-foreground">
                  正在逐个平台改写，平台越多耗时越长，请勿关闭弹窗…
                </p>
              )}

              {error && <p className="text-[11px] text-red-500 leading-relaxed">{error}</p>}

              {titles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">点击采用标题</p>
                  {titles.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => applyTitle(t)}
                      className="w-full text-left text-[11px] px-2 py-1.5 rounded bg-background/80 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {summary && (
                <div className="space-y-1">
                  <p className="text-[11px] leading-relaxed bg-background/80 rounded p-2">{summary}</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={applySummary}
                      className="text-[10px] px-2 py-1 rounded bg-violet-500 text-white hover:bg-violet-600"
                    >
                      采用为摘要
                    </button>
                    <button
                      onClick={() => setSummary('')}
                      className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/70"
                    >
                      忽略
                    </button>
                  </div>
                </div>
              )}

              {tags.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">点击选择标签</p>
                  <div className="flex flex-wrap gap-1">
                    {tags.map(tag => {
                      const active = (article.tags || []).includes(tag)
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                            active
                              ? 'bg-violet-500 text-white border-violet-500'
                              : 'bg-background/80 border-border hover:border-violet-400'
                          )}
                        >
                          {active && <Check className="w-2.5 h-2.5 inline mr-0.5" />}
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {adaptNote && (
                <p className="text-[11px] text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {adaptNote}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] transition-colors',
        'bg-background/80 border border-border hover:border-violet-400 hover:text-violet-600',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

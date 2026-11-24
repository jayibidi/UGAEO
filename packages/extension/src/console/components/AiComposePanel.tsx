import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Image as ImageIcon,
  Info,
  Loader2,
  PenLine,
  RotateCcw,
  Settings2,
  Sparkles,
} from 'lucide-react'
import type { DraftLength, DraftResult } from '@ugaeo/core'
import {
  describeAIBlocker,
  getAISettings,
  type AISettings,
} from '../../lib/ai-settings'

interface Props {
  /** 当前标题，作为生成稿的上下文 */
  title: string
  /** 正文是否已经有内容（用于提示会覆盖） */
  hasBody: boolean
  /** 应用生成好的整篇稿 */
  onApplyDraft: (draft: DraftResult) => void
  /** 把生成的配图插进正文 */
  onInsertImage: (dataUrl: string) => void
  /** 把生成的配图设为封面 */
  onSetCover: (dataUrl: string) => void
  /** 打开 AI 设置弹窗（focus 决定高亮哪一栏） */
  onOpenSettings: (focus: 'text' | 'image') => void
  onNotice?: (message: string, kind?: 'ok' | 'error' | 'info') => void
}

type Tab = 'text' | 'image'

interface GeneratedImage {
  dataUrl: string
  model: string
  revisedPrompt?: string
}

const LENGTHS: Array<{ key: DraftLength; label: string; hint: string }> = [
  { key: 'short', label: '短', hint: '600~900 字' },
  { key: 'medium', label: '中', hint: '1200~1600 字' },
  { key: 'long', label: '长', hint: '2000~2600 字' },
]

const PLACEHOLDER: Record<Tab, string> = {
  text: '输入标题或提示词，让 AI 帮你生成文稿…',
  image: '描述你想要的配图，如：扁平插画风格的封面图，蓝绿配色…',
}

/**
 * 编辑器里的 AI 对话框
 *
 * 两个模式共用一个输入框：
 * - 文案：输入标题或一句话需求 → 一次生成标题 / 摘要 / 标签 / 正文并回填；
 * - 配图：描述画面 → 走生图模型出图，可插入正文或设为封面。
 *
 * 没配 Key / 没开开关时不让用户白等一轮：直接显示缺什么，并给一个能点的「去设置」。
 */
export function AiComposePanel({
  title,
  hasBody,
  onApplyDraft,
  onInsertImage,
  onSetCover,
  onOpenSettings,
  onNotice,
}: Props) {
  const [tab, setTab] = useState<Tab>('text')
  const [input, setInput] = useState('')
  const [length, setLength] = useState<DraftLength>('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<GeneratedImage | null>(null)
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<number | null>(null)

  const loadSettings = useCallback(() => {
    getAISettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    loadSettings()
    // 用户在设置弹窗 / 扩展弹窗里改了配置，这里要立刻松绑（否则还显示「去设置」）
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.aiSettings) loadSettings()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [loadSettings])

  // 生成中显示秒数：长文要 20~40 秒，不给反馈用户会以为卡死
  useEffect(() => {
    if (!busy) {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      setElapsed(0)
      return
    }
    const started = Date.now()
    timerRef.current = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [busy])

  const blocker = settings ? describeAIBlocker(settings, tab) : null
  const canSend = !!input.trim() && !busy && !blocker

  const runDraft = async (prompt: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'AI_TASK',
      payload: {
        type: 'draft',
        prompt,
        title: title.trim() || undefined,
        length,
      },
    })
    if (!response?.ok) throw new Error(response?.error || '生成失败')
    const draft = response.data as DraftResult
    if (!draft?.markdown?.trim()) throw new Error('AI 没有返回正文，请换个说法再试')
    return draft
  }

  const runImage = async (prompt: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'AI_TASK',
      payload: { type: 'image', prompt },
    })
    if (!response?.ok) throw new Error(response?.error || '生图失败')
    const result = response.data as GeneratedImage
    if (!result?.dataUrl) throw new Error('生图接口没有返回图片')
    return result
  }

  const submit = async () => {
    const prompt = input.trim()
    if (!prompt || busy || blocker) return

    setBusy(true)
    setError('')
    if (tab === 'image') setImage(null)

    try {
      if (tab === 'text') {
        const draft = await runDraft(prompt)
        onApplyDraft(draft)
        onNotice?.(
          `已生成《${draft.title || '未命名'}》，可以直接改，也可以撤销`,
          'ok'
        )
      } else {
        const result = await runImage(prompt)
        setImage(result)
        onNotice?.('配图已生成，点「插入正文」或「设为封面」使用', 'ok')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const assistantLine = tab === 'text' ? 'Sparkles · 文本模型' : '生图模型 · /images/generations'

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-2.5">
      {/* 模式切换 */}
      <div className="flex items-center gap-1.5">
        {(
          [
            { key: 'text' as Tab, label: '文案', Icon: PenLine },
            { key: 'image' as Tab, label: '配图', Icon: ImageIcon },
          ]
        ).map(item => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key)
                setError('')
              }}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.Icon className="h-3 w-3" />
              {item.label}
            </button>
          )
        })}

        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          {assistantLine}
        </span>
      </div>

      {/* 输入框 */}
      <div className="relative mt-2 rounded-lg border bg-background focus-within:ring-1 focus-within:ring-primary">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          spellCheck={false}
          disabled={!!blocker || busy}
          placeholder={PLACEHOLDER[tab]}
          className="h-16 w-full resize-none bg-transparent px-3 py-2 pr-11 text-[12.5px] leading-relaxed outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          title={blocker ? blocker.message : '生成（Enter 发送，Shift+Enter 换行）'}
          className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* 篇幅（只对文案有意义） */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        {tab === 'text' ? (
          <>
            <span className="text-muted-foreground">篇幅</span>
            {LENGTHS.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setLength(item.key)}
                title={item.hint}
                className={`rounded px-1.5 py-0.5 transition-colors ${
                  length === item.key
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
            {hasBody && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <RotateCcw className="h-3 w-3" />
                会覆盖当前正文（可撤销）
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            生成后可直接插入正文或设为封面，图片会以 dataURL 内联，不依赖图床
          </span>
        )}
      </div>

      {/* 未配置 */}
      {blocker && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 leading-relaxed">{blocker.message}</span>
          <button
            type="button"
            onClick={() => onOpenSettings(tab === 'image' ? 'image' : 'text')}
            className="flex flex-shrink-0 items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
          >
            <Settings2 className="h-3 w-3" />
            去设置
          </button>
        </div>
      )}

      {/* 生成中 */}
      {busy && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tab === 'text'
            ? `正在写稿…（${elapsed}s）长文通常要 20~40 秒`
            : `正在出图…（${elapsed}s）通常要 10~40 秒`}
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      {/* 配图结果 */}
      {image && tab === 'image' && (
        <div className="mt-2 flex gap-2 rounded-lg border bg-background p-2">
          <img
            src={image.dataUrl}
            alt="AI 生成的配图"
            className="h-20 w-20 flex-shrink-0 rounded-md border object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-muted-foreground">模型：{image.model}</p>
            {image.revisedPrompt && (
              <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                改写后的提示词：{image.revisedPrompt}
              </p>
            )}
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[11px] hover:bg-muted"
                onClick={() => {
                  onInsertImage(image.dataUrl)
                  onNotice?.('已插入正文', 'ok')
                }}
              >
                插入正文
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[11px] hover:bg-muted"
                onClick={() => {
                  onSetCover(image.dataUrl)
                  onNotice?.('已设为封面', 'ok')
                }}
              >
                设为封面
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

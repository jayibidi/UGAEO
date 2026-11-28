import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Check,
  Clapperboard,
  Copy,
  Download,
  Flame,
  Image as ImageIcon,
  Info,
  Loader2,
  PenLine,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  describeAIBlocker,
  getAISettings,
  type AISettings,
} from '../../lib/ai-settings'
import { AISettingsDialog } from '../components/AISettingsDialog'
import { renderMarkdownLite } from '../lib/markdown-lite'

type ChatMsg =
  | { id: string; role: 'user'; kind: 'text'; content: string }
  | { id: string; role: 'assistant'; kind: 'text'; content: string; model?: string }
  | {
      id: string
      role: 'assistant'
      kind: 'image'
      dataUrl: string
      model: string
      prompt: string
      revisedPrompt?: string
    }

type Mode = 'text' | 'image'

interface Suggestion {
  icon: typeof Flame
  title: string
  desc: string
  mode: Mode
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: Flame,
    title: '蹭个热点',
    desc: '看看现在微博和抖音有什么值得写的，挑几个适合我做的选题',
    mode: 'text',
    prompt: '帮我看看现在有哪些适合做内容的讨论方向，给我 5 个可以直接开写的选题，每个说明为什么值得写、适合发什么平台。',
  },
  {
    icon: PenLine,
    title: '写小红书文案',
    desc: '帮我写一条小红书种草文案，主题先问我',
    mode: 'text',
    prompt: '我想写一条小红书的种草笔记。先问我 3 个关键问题（产品是什么、给谁看、最想突出的卖点），问完再动笔。',
  },
  {
    icon: ImageIcon,
    title: '做金句卡片',
    desc: '把一句走心的话做成一张适合发朋友圈的金句卡片',
    mode: 'image',
    prompt: '一张极简风格的中文金句卡片，深色背景，中间一行手写体大字「慢一点也没关系」，下方大面积留白，无其他装饰。',
  },
  {
    icon: Clapperboard,
    title: '口播脚本',
    desc: '帮我写一条 60 秒的口播短视频脚本，主题先问我',
    mode: 'text',
    prompt: '帮我写一条 60 秒的口播短视频脚本。先问我主题和目标人群，再按「钩子 - 展开 - 收尾」三段写，标出需要停顿和重音的地方。',
  },
]

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 复制到剪贴板：dataURL 图片按 PNG 写，纯文本按文本写 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function AiChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>('text')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const loadSettings = useCallback(() => {
    getAISettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    loadSettings()
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.aiSettings) loadSettings()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [loadSettings])

  // 生成中显示秒数：长文要 20~40 秒，光转圈用户会以为卡死
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

  // 新消息进来滚到底
  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

  const blocker = settings ? describeAIBlocker(settings, mode) : null
  const canSend = !!input.trim() && !busy && !blocker

  const activeModel = useMemo(() => {
    if (!settings) return ''
    return mode === 'image' ? settings.imageModel : settings.model
  }, [settings, mode])

  const push = (message: ChatMsg) => setMessages(prev => [...prev, message])

  const submit = async () => {
    const prompt = input.trim()
    if (!prompt || busy || blocker) return

    setError('')
    setInput('')
    push({ id: newId(), role: 'user', kind: 'text', content: prompt })
    setBusy(true)

    try {
      if (mode === 'image') {
        const response = await chrome.runtime.sendMessage({
          type: 'AI_TASK',
          payload: { type: 'image', prompt },
        })
        if (!response?.ok) throw new Error(response?.error || '生图失败')
        const result = response.data as { dataUrl: string; model: string; revisedPrompt?: string }
        if (!result?.dataUrl) throw new Error('生图接口没有返回图片')
        push({
          id: newId(),
          role: 'assistant',
          kind: 'image',
          dataUrl: result.dataUrl,
          model: result.model,
          prompt,
          revisedPrompt: result.revisedPrompt,
        })
      } else {
        // 只带最近 12 条文本消息：再往上翻的上下文对写稿帮助不大，还白烧 token
        const history = messages
          .filter((message): message is Extract<ChatMsg, { kind: 'text' }> => message.kind === 'text')
          .slice(-12)
          .map(message => ({ role: message.role, content: message.content }))

        const response = await chrome.runtime.sendMessage({
          type: 'AI_TASK',
          payload: {
            type: 'chat',
            messages: [...history, { role: 'user', content: prompt }],
          },
        })
        if (!response?.ok) throw new Error(response?.error || '对话失败')
        const text = String(response.data || '').trim()
        if (!text) throw new Error('AI 没有返回内容，换个说法再试')
        push({
          id: newId(),
          role: 'assistant',
          kind: 'text',
          content: text,
          model: settings?.model,
        })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      // 生成完把焦点还给输入框，方便接着问
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const handleCopy = async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  const downloadImage = (message: Extract<ChatMsg, { kind: 'image' }>) => {
    const suffix = message.dataUrl.includes('image/jpeg') ? 'jpg' : 'png'
    const link = document.createElement('a')
    link.href = message.dataUrl
    link.download = `ai-image-${message.id}.${suffix}`
    link.click()
  }

  const composer = (
    <div className="w-full">
      <div className="rounded-2xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/60">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={messages.length ? 2 : 3}
          spellCheck={false}
          disabled={!!blocker || busy}
          placeholder={
            mode === 'image'
              ? '描述你想要的画面，例如：极简风格的中文金句卡片，深色背景…'
              : messages.length
                ? '继续问，或者让它把刚才那版改短 / 换个语气…'
                : '说出你想写什么，选题 / 标题 / 大纲 / 改稿都行…'
          }
          className="w-full resize-none bg-transparent px-4 pt-3.5 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          <div className="flex items-center gap-1 rounded-full bg-muted/70 p-0.5">
            {(
              [
                { key: 'text' as Mode, label: '对话', Icon: Sparkles },
                { key: 'image' as Mode, label: '生图', Icon: ImageIcon },
              ]
            ).map(item => {
              const active = mode === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setMode(item.key)
                    setError('')
                    inputRef.current?.focus()
                  }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <item.Icon className="h-3 w-3" />
                  {item.label}
                </button>
              )
            })}
          </div>

          <span className="ml-auto hidden truncate text-[10.5px] text-muted-foreground sm:block">
            {!blocker && activeModel
              ? `Enter 发送 · Shift+Enter 换行 · ${activeModel}`
              : 'Enter 发送 · Shift+Enter 换行'}
          </span>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            title={blocker ? blocker.message : '发送'}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {blocker && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 leading-relaxed">{blocker.message}</span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex flex-shrink-0 items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
          >
            <Settings2 className="h-3 w-3" />
            去设置
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-1 flex-col">
      {messages.length === 0 ? (
        // 空态：问候 + 输入 + 建议卡，整体居中
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center py-6">
          <div className="mb-6 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              UG·AEO
            </p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight">
              {greeting()}，想创作点什么？
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              从选题到发布，一站式帮你把想法做成能发的内容。
            </p>
          </div>

          {composer}

          <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {SUGGESTIONS.map(item => (
              <button
                key={item.title}
                type="button"
                onClick={() => {
                  setMode(item.mode)
                  setInput(item.prompt)
                  inputRef.current?.focus()
                }}
                className="group flex gap-2.5 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <item.icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground group-hover:text-primary" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
                {item.mode === 'image' && (
                  <span className="ml-auto flex-shrink-0 self-start rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-400">
                    生图
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              AI 对话
              <span className="text-[11px]">· {messages.filter(m => m.role === 'user').length} 轮</span>
            </div>
            <button
              type="button"
              className="uga-btn-ghost px-2 py-1 text-[11px]"
              onClick={() => {
                setMessages([])
                setError('')
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空对话
            </button>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.map(message => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[12.5px] leading-relaxed text-primary-foreground">
                      {message.content}
                    </div>
                  </div>
                )
              }

              if (message.kind === 'image') {
                return (
                  <div key={message.id} className="flex gap-2">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                      <ImageIcon className="h-3.5 w-3.5 text-violet-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <img
                        src={message.dataUrl}
                        alt={message.prompt}
                        className="max-h-[320px] max-w-[min(420px,100%)] rounded-xl border object-contain"
                      />
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] text-muted-foreground">{message.model}</span>
                        <button
                          type="button"
                          className="rounded-md border px-1.5 py-0.5 text-[10.5px] hover:bg-muted"
                          onClick={() => downloadImage(message)}
                        >
                          <Download className="mr-0.5 inline h-3 w-3" />
                          下载
                        </button>
                        <button
                          type="button"
                          className="rounded-md border px-1.5 py-0.5 text-[10.5px] hover:bg-muted"
                          onClick={() => void handleCopy(message.id, message.prompt)}
                        >
                          {copiedId === message.id ? (
                            <Check className="mr-0.5 inline h-3 w-3" />
                          ) : (
                            <Copy className="mr-0.5 inline h-3 w-3" />
                          )}
                          {copiedId === message.id ? '已复制' : '复制提示词'}
                        </button>
                      </div>
                      {message.revisedPrompt && (
                        <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
                          改写后：{message.revisedPrompt}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <div key={message.id} className="flex gap-2">
                  <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[12.5px] text-foreground"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownLite(message.content) }}
                    />
                    <div className="mt-1 flex items-center gap-1.5">
                      {message.model && (
                        <span className="text-[10.5px] text-muted-foreground">{message.model}</span>
                      )}
                      <button
                        type="button"
                        className="rounded-md px-1 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => void handleCopy(message.id, message.content)}
                      >
                        {copiedId === message.id ? (
                          <Check className="mr-0.5 inline h-3 w-3" />
                        ) : (
                          <Copy className="mr-0.5 inline h-3 w-3" />
                        )}
                        {copiedId === message.id ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {busy && (
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {mode === 'image'
                  ? `正在出图…（${elapsed}s）通常要 10~40 秒`
                  : `正在思考…（${elapsed}s）长文通常要 20~40 秒`}
              </div>
            )}
          </div>

          <div className="pt-3">{composer}</div>
        </>
      )}

      <AISettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} focus={mode} />
    </div>
  )
}

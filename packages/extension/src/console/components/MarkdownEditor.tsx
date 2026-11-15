import { useMemo, useRef, useState } from 'react'
import {
  Bold,
  Code,
  Eye,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pencil,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from 'lucide-react'
import {
  applyHtmlCommand,
  applyMarkdownCommand,
  renderMarkdown,
  type HtmlCommand,
  type MarkdownCommand,
} from '../lib/markdown'
import { imageToDataUrl } from '../lib/image'

type Format = 'markdown' | 'html'

interface Props {
  value: string
  onChange: (next: string) => void
  format: Format
  onFormatChange: (next: Format) => void
  placeholder?: string
  /** 正文区高度类名，默认 h-72 */
  heightClass?: string
  /** 粘贴/拖入图片失败时提示（默认静默） */
  onImageError?: (message: string) => void
}

interface ToolButtonProps {
  title: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}

function ToolButton({ title, onClick, active, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // 关键：按下时不让 textarea 失焦，否则选区丢了，命令只能作用在末尾
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="mx-1 h-4 w-px bg-border" />

/**
 * 通用正文编辑器
 *
 * 工具栏走「对选区做操作」的纯函数（lib/markdown.ts），所以：
 * - 选一段文字点加粗 = 包裹；再点一次 = 取消；
 * - 每行开头加 `- ` = 列表，再点一次 = 去掉；
 * - 图片可以直接 Ctrl+V 粘进来（转成 dataURL 内联，不依赖图床）。
 */
export function MarkdownEditor({
  value,
  onChange,
  format,
  onFormatChange,
  placeholder,
  heightClass = 'h-72',
  onImageError,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const [pasting, setPasting] = useState(false)

  const plainLength = useMemo(() => {
    const text = format === 'markdown' ? value.replace(/!\[[^\]]*\]\([^)]*\)/g, '') : value.replace(/<[^>]+>/g, '')
    return text.replace(/\s/g, '').length
  }, [value, format])

  const previewHtml = useMemo(() => {
    if (!preview) return ''
    return format === 'markdown' ? renderMarkdown(value) : value
  }, [preview, value, format])

  /** 把命令结果写回并恢复选区 */
  const runCommand = (command: MarkdownCommand | HtmlCommand) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length

    const result =
      format === 'markdown'
        ? applyMarkdownCommand(value, start, end, command as MarkdownCommand)
        : applyHtmlCommand(value, start, end, command as HtmlCommand)

    onChange(result.value)
    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(result.start, result.end)
    })
  }

  const insertSnippet = (snippet: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`
    onChange(next)
    const cursor = start + snippet.length
    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
  }

  const handleImage = async (file: File) => {
    setPasting(true)
    try {
      const dataUrl = await imageToDataUrl(file)
      insertSnippet(format === 'markdown' ? `\n![图片](${dataUrl})\n` : `<img src="${dataUrl}" alt="图片" />`)
    } catch (error) {
      onImageError?.((error as Error).message || '图片处理失败')
    } finally {
      setPasting(false)
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    void handleImage(file)
  }

  const onDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.dataTransfer?.files || []).find(item => item.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void handleImage(file)
  }

  const tools =
    format === 'markdown' ? (
      <>
        <ToolButton title="加粗 (Ctrl+B)" onClick={() => runCommand('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="斜体 (Ctrl+I)" onClick={() => runCommand('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="删除线" onClick={() => runCommand('strike')}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="行内代码" onClick={() => runCommand('inlineCode')}>
          <Code className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="二级标题" onClick={() => runCommand('h2')}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="三级标题" onClick={() => runCommand('h3')}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="引用" onClick={() => runCommand('quote')}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="无序列表" onClick={() => runCommand('bullet')}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="有序列表" onClick={() => runCommand('ordered')}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="链接" onClick={() => runCommand('link')}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="图片（也可直接粘贴/拖入）" onClick={() => runCommand('image')}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="代码块" onClick={() => runCommand('codeBlock')}>
          <SquareCode className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="表格" onClick={() => runCommand('table')}>
          <Table className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="分割线" onClick={() => runCommand('hr')}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
      </>
    ) : (
      <>
        <ToolButton title="加粗" onClick={() => runCommand('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="斜体" onClick={() => runCommand('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="二级标题" onClick={() => runCommand('h2')}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="三级标题" onClick={() => runCommand('h3')}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="段落" onClick={() => runCommand('paragraph')}>
          <Pencil className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="引用" onClick={() => runCommand('quote')}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="无序列表" onClick={() => runCommand('ul')}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="有序列表" onClick={() => runCommand('ol')}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="链接" onClick={() => runCommand('link')}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="图片（也可直接粘贴/拖入）" onClick={() => runCommand('image')}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="分割线" onClick={() => runCommand('hr')}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
      </>
    )

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        {!preview && tools}
        {preview && <span className="px-2 text-[11px] text-muted-foreground">预览（只读）</span>}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPreview(prev => !prev)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
              preview ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {preview ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {preview ? '继续编辑' : '预览'}
          </button>
          <div className="flex gap-0.5 rounded-md bg-background p-0.5 text-[11px]">
            {(['markdown', 'html'] as const).map(item => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (item === format) return
                  onFormatChange(item)
                  setPreview(false)
                }}
                className={`rounded px-2 py-0.5 transition-colors ${
                  format === item ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item === 'markdown' ? 'Markdown' : 'HTML'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {preview ? (
        <div className={`${heightClass} overflow-y-auto px-3 py-2 text-sm`}>
          {plainLength === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">还没有内容</p>
          ) : format === 'markdown' ? (
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={event => onChange(event.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          spellCheck={false}
          className={`${heightClass} w-full resize-y bg-transparent px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none`}
          placeholder={placeholder}
        />
      )}

      <div className="flex items-center justify-between border-t px-2.5 py-1 text-[11px] text-muted-foreground">
        <span>
          {plainLength} 字 · {format === 'markdown' ? 'Markdown' : 'HTML'} · 可直接粘贴图片
        </span>
        <span>{pasting ? '正在处理图片…' : preview ? '预览模式' : 'Ctrl+S 保存'}</span>
      </div>
    </div>
  )
}

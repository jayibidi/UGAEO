/**
 * 轻量 Markdown 渲染 + 编辑器工具栏操作
 *
 * 为什么自己写而不是装 marked / react-markdown：
 *   1. 扩展包体积已经不小，编辑器只用来「看一眼自己排的版」，不需要完整 CommonMark；
 *   2. 内容最终是交给各平台自己解析的，这里渲染得再全也不会传过去，
 *      真正要保证的是「工具栏插入的语法是对的」+「预览不把 HTML 注进来」；
 *   3. 纯函数，好测。`markdown.test.ts` 覆盖了渲染与插入两条路径。
 *
 * 注意：渲染结果用于 dangerouslySetInnerHTML，所有原文先 escape，再按标记替换，
 * 链接与图片地址只放行 http(s) / data:image / 相对路径，挡掉 javascript: 之类。
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch])
}

/** 只允许安全协议；其余一律替换成 #，避免把 javascript: 塞进 href */
function safeUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return '#'
  if (/^(https?:|data:image\/|#|\/|\.\/|\.\.\/)/i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return '#'
  // 没有协议的裸域名（www.xxx.com）补 https，预览里点得开
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) return `https://${url}`
  return url
}

/** 行内语法：代码、图片、链接、粗体、斜体、删除线 */
export function renderInline(text: string): string {
  let html = escapeHtml(text)

  // 行内代码先处理，避免里面的 * _ 被后续规则吃掉
  const codes: string[] = []
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code)
    return `\u0000CODE${codes.length - 1}\u0000`
  })

  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, src: string) => {
    return `<img src="${safeUrl(src)}" alt="${alt}" class="my-2 max-w-full rounded-lg" />`
  })

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    return `<a href="${safeUrl(href)}" target="_blank" rel="noreferrer" class="text-primary underline">${label}</a>`
  })

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_m, index: string) => {
    return `<code class="rounded bg-muted px-1 py-0.5 text-[12px]">${codes[Number(index)]}</code>`
  })

  return html
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())
}

/** 块级渲染：标题、引用、列表、代码块、表格、分割线、段落 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = () => {
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    const items = list.items.map(item => `<li>${renderInline(item)}</li>`).join('')
    out.push(`<${tag} class="my-2 ml-5 list-${list.ordered ? 'decimal' : 'disc'} space-y-1">${items}</${tag}>`)
    list = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith('```')) {
      flushList()
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      out.push(
        `<pre class="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed"><code>${escapeHtml(
          body.join('\n')
        )}</code></pre>`
      )
      continue
    }

    if (!trimmed) {
      flushList()
      continue
    }

    // 分割线（要在列表之前判断，避免 --- 被当成列表项）
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList()
      out.push('<hr class="my-4 border-dashed" />')
      continue
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushList()
      const level = heading[1].length
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm']
      out.push(`<h${level} class="mt-4 mb-2 font-semibold ${sizes[level - 1]}">${renderInline(heading[2])}</h${level}>`)
      continue
    }

    // 引用（连续的 > 行合并成一个 blockquote）
    if (trimmed.startsWith('>')) {
      flushList()
      const body: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        body.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      i -= 1
      out.push(
        `<blockquote class="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground">${renderInline(
          body.join(' ')
        )}</blockquote>`
      )
      continue
    }

    // 表格：本行有 | 且下一行是分隔行
    if (trimmed.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushList()
      const header = splitRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      i -= 1
      const head = header.map(cell => `<th class="border px-2 py-1 text-left font-medium">${renderInline(cell)}</th>`).join('')
      const body = rows
        .map(row => `<tr>${row.map(cell => `<td class="border px-2 py-1">${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table class="my-3 w-full border-collapse text-[13px]"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
      continue
    }

    // 列表
    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (unordered || ordered) {
      const isOrdered = !!ordered
      const text = (unordered ? unordered[1] : ordered![1]).trim()
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(text)
      continue
    }

    // 段落（普通换行按 <br> 处理，符合中文写作习惯）
    flushList()
    const paragraph: string[] = [trimmed]
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(lines[i + 1].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i + 1].trim())
    ) {
      i += 1
      paragraph.push(lines[i].trim())
    }
    out.push(`<p class="my-2 leading-relaxed">${paragraph.map(renderInline).join('<br />')}</p>`)
  }

  flushList()
  return out.join('\n')
}

export type MarkdownCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'bullet'
  | 'ordered'
  | 'link'
  | 'image'
  | 'codeBlock'
  | 'table'
  | 'hr'

export interface EditResult {
  value: string
  start: number
  end: number
}

/** 行内包裹；已经包着同样的标记时取消（再点一次 = 去掉格式） */
function wrapInline(value: string, start: number, end: number, left: string, right = left, placeholder = ''): EditResult {
  const selected = value.slice(start, end)
  const before = value.slice(0, start)
  const after = value.slice(end)

  if (selected.startsWith(left) && selected.endsWith(right) && selected.length >= left.length + right.length) {
    const inner = selected.slice(left.length, selected.length - right.length)
    return { value: `${before}${inner}${after}`, start, end: start + inner.length }
  }

  // 选中区两侧已有标记 → 一并去掉
  if (before.endsWith(left) && after.startsWith(right)) {
    return {
      value: `${before.slice(0, before.length - left.length)}${selected}${after.slice(right.length)}`,
      start: start - left.length,
      end: end - left.length,
    }
  }

  const text = selected || placeholder
  return {
    value: `${before}${left}${text}${right}${after}`,
    start: start + left.length,
    end: start + left.length + text.length,
  }
}

/** 给选中的每一行加/去前缀 */
function toggleLinePrefix(value: string, start: number, end: number, prefix: string, ordered = false): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')

  const matcher = ordered ? /^\d+[.)]\s+/ : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  const allPrefixed = lines.every(line => !line.trim() || matcher.test(line))

  const next = lines
    .map((line, index) => {
      if (!line.trim()) return line
      if (allPrefixed) return line.replace(matcher, '')
      return `${ordered ? `${index + 1}. ` : prefix}${line}`
    })
    .join('\n')

  return {
    value: `${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + next.length,
  }
}

/** 在光标处插入一段块级内容，并把光标放到第一处占位符 */
function insertBlock(value: string, start: number, end: number, template: string, cursorOffset: number): EditResult {
  const needsLeadingBreak = start > 0 && value[start - 1] !== '\n'
  const prefix = needsLeadingBreak ? '\n\n' : ''
  const next = `${value.slice(0, start)}${prefix}${template}${value.slice(end)}`
  const cursor = start + prefix.length + cursorOffset
  return { value: next, start: cursor, end: cursor }
}

export function applyMarkdownCommand(value: string, start: number, end: number, command: MarkdownCommand): EditResult {
  switch (command) {
    case 'bold':
      return wrapInline(value, start, end, '**', '**', '粗体')
    case 'italic':
      return wrapInline(value, start, end, '*', '*', '斜体')
    case 'strike':
      return wrapInline(value, start, end, '~~', '~~', '删除线')
    case 'inlineCode':
      return wrapInline(value, start, end, '`', '`', '代码')
    case 'h2':
      return toggleLinePrefix(value, start, end, '## ')
    case 'h3':
      return toggleLinePrefix(value, start, end, '### ')
    case 'quote':
      return toggleLinePrefix(value, start, end, '> ')
    case 'bullet':
      return toggleLinePrefix(value, start, end, '- ')
    case 'ordered':
      return toggleLinePrefix(value, start, end, '1. ', true)
    case 'link': {
      const selected = value.slice(start, end) || '链接文字'
      return wrapInline(value, start, end, '[', '](https://)', selected)
    }
    case 'image':
      return insertBlock(value, start, end, '![图片说明](https://)', 2)
    case 'codeBlock':
      return insertBlock(value, start, end, '```\n代码\n```', 4)
    case 'table':
      return insertBlock(
        value,
        start,
        end,
        '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |',
        2
      )
    case 'hr':
      return insertBlock(value, start, end, '---\n', 4)
    default:
      return { value, start, end }
  }
}

export type HtmlCommand = 'bold' | 'italic' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'link' | 'image' | 'hr' | 'paragraph'

const HTML_TAGS: Record<Exclude<HtmlCommand, 'hr' | 'paragraph' | 'ul' | 'ol'>, [string, string, string]> = {
  bold: ['<strong>', '</strong>', '粗体'],
  italic: ['<em>', '</em>', '斜体'],
  h2: ['<h2>', '</h2>', '小标题'],
  h3: ['<h3>', '</h3>', '小标题'],
  quote: ['<blockquote>', '</blockquote>', '引用'],
  link: ['<a href="https://">', '</a>', '链接文字'],
  image: ['<img src="https://" alt="', '">', '图片说明'],
}

/** HTML 模式下的工具栏：直接包标签，正文最终按 html 传给平台 */
export function applyHtmlCommand(value: string, start: number, end: number, command: HtmlCommand): EditResult {
  if (command === 'hr') return insertBlock(value, start, end, '<hr />\n', 7)
  if (command === 'paragraph') return insertBlock(value, start, end, '<p>正文</p>', 3)
  if (command === 'ul') return insertBlock(value, start, end, '<ul>\n  <li>列表项</li>\n</ul>', 11)
  if (command === 'ol') return insertBlock(value, start, end, '<ol>\n  <li>列表项</li>\n</ol>', 11)

  const [open, close, placeholder] = HTML_TAGS[command]
  return wrapInline(value, start, end, open, close, placeholder)
}

/** 从 Markdown 里取一段纯文本做摘要（去标记、压缩空白） */
export function plainTextOf(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

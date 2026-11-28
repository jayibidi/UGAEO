/**
 * 极简 Markdown → HTML
 *
 * 只服务一个场景：AI 对话里把回复渲染得能看（标题、列表、粗体、代码、引用）。
 * 不引新依赖 —— core 里虽然有 marked，但那是给正文转换用的重家伙，控制台按需
 * 打包进来不划算。
 *
 * 安全：先整体转义，再按白名单替换标记，所以模型输出里的 `<script>` 不会生效。
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  return (
    text
      // 行内代码先处理，避免里面的星号被当成粗体
      .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[0.9em]">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // 只认 http(s)，避免 javascript: 之类的协议混进来
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer" class="text-primary underline">$1</a>'
      )
  )
}

export function renderMarkdownLite(source: string): string {
  const lines = escapeHtml(source).split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuffer: string[] = []

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    // 代码块
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(
          `<pre class="overflow-x-auto rounded-lg bg-muted p-2.5 text-[11.5px] leading-relaxed"><code>${codeBuffer.join('\n')}</code></pre>`
        )
        codeBuffer = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      const size = ['text-base', 'text-[15px]', 'text-sm', 'text-[13px]'][level - 1]
      out.push(`<p class="mt-2 mb-1 ${size} font-semibold">${inline(heading[2])}</p>`)
      continue
    }

    // 注意：整体转义在前，所以这里匹配的是 &gt; 而不是 >
    const quote = line.match(/^&gt;\s?(.*)$/)
    if (quote) {
      closeList()
      out.push(
        `<blockquote class="my-1 border-l-2 border-border pl-2 text-muted-foreground">${inline(quote[1])}</blockquote>`
      )
      continue
    }

    const ordered = line.match(/^\s*(\d+)[.、)]\s+(.*)$/)
    if (ordered) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol class="my-1 list-decimal space-y-0.5 pl-5">')
        listType = 'ol'
      }
      out.push(`<li>${inline(ordered[2])}</li>`)
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (bullet) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul class="my-1 list-disc space-y-0.5 pl-5">')
        listType = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p class="my-1 leading-relaxed">${inline(line)}</p>`)
  }

  if (inCode && codeBuffer.length) {
    out.push(
      `<pre class="overflow-x-auto rounded-lg bg-muted p-2.5 text-[11.5px] leading-relaxed"><code>${codeBuffer.join('\n')}</code></pre>`
    )
  }
  closeList()

  return out.join('')
}

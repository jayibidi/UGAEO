/**
 * 飞书块的 DOM → HTML（纯函数，不碰全局状态）
 *
 * 为什么单独一个文件：`extractor.ts` 是 content script 入口，顶层会注册消息监听、
 * 依赖 chrome / document，没法在单测里直接导入。把这块纯逻辑拆出来，
 * 就能用 stub 元素覆盖「块类型 → 标签」的映射。
 */

/** 块的纯文本：优先 innerText（保留换行），拿不到就退回 textContent */
export function blockText(el: HTMLElement): string {
  const inner = (el as unknown as { innerText?: string }).innerText
  if (typeof inner === 'string' && inner.trim()) return inner
  return el.textContent || ''
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 把一个飞书块转成 HTML
 *
 * 只保证结构和文本，不追求逐字格式（加粗、颜色这些在 DOM 兜底里拿不准，
 * 首选还是 clientVars 那条路）。
 */
export function renderFeishuDomBlock(el: HTMLElement): string {
  const type = (
    el.getAttribute('data-block-type') ||
    el.getAttribute('data-block') ||
    ''
  ).toLowerCase()

  // 图片块：优先取真实 src
  const img = el.querySelector('img')
  if (img && (type.includes('image') || !blockText(el).trim())) {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || ''
    return src ? `<p><img src="${escapeHtml(src)}"></p>` : ''
  }

  // 代码块：保留换行，别被 innerText 吃掉缩进
  if (type.includes('code')) {
    const codeEl = el.querySelector('pre, code, [data-code-block]') as HTMLElement | null
    const code = codeEl ? blockText(codeEl) : blockText(el)
    return code.trim() ? `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>` : ''
  }

  // 分割线没有文字，必须在「空块返回空串」之前处理，否则会被吞掉
  if (type.includes('divider') || type.includes('hr')) return '<hr>'

  const text = blockText(el).trim()
  if (!text) return ''
  const para = escapeHtml(text).replace(/\n/g, '<br>')

  if (type.includes('heading1') || type === 'h1') return `<h1>${para}</h1>`
  if (type.includes('heading2') || type === 'h2') return `<h2>${para}</h2>`
  if (type.includes('heading3') || type === 'h3') return `<h3>${para}</h3>`
  if (type.includes('heading4')) return `<h4>${para}</h4>`
  if (type.includes('heading5')) return `<h5>${para}</h5>`
  if (type.includes('heading6')) return `<h6>${para}</h6>`
  if (type.includes('bullet')) return `<ul><li>${para}</li></ul>`
  if (type.includes('ordered') || type.includes('number')) return `<ol><li>${para}</li></ol>`
  if (type.includes('quote') || type.includes('callout')) return `<blockquote><p>${para}</p></blockquote>`
  // 表格在 DOM 里是逐格渲染的，转不出一张完整表，按段落保留文字
  if (type.includes('table')) return `<p>${para}</p>`

  const tag = (el.tagName || '').toLowerCase()
  if (/^h[1-6]$/.test(tag)) return `<${tag}>${para}</${tag}>`
  if (tag === 'li') return `<ul><li>${para}</li></ul>`
  if (tag === 'blockquote') return `<blockquote><p>${para}</p></blockquote>`
  return `<p>${para}</p>`
}

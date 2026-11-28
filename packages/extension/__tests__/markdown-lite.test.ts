import { describe, expect, it } from 'vitest'
import { renderMarkdownLite } from '../src/console/lib/markdown-lite'

describe('renderMarkdownLite', () => {
  it('标题渲染成加粗段落', () => {
    const html = renderMarkdownLite('## 三个选题方向')
    expect(html).toContain('font-semibold')
    expect(html).toContain('三个选题方向')
  })

  it('无序与有序列表各自成组，不会互相套', () => {
    const html = renderMarkdownLite('- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二')
    expect(html).toContain('<ul class="my-1 list-disc space-y-0.5 pl-5">')
    expect(html).toContain('<ol class="my-1 list-decimal space-y-0.5 pl-5">')
    // 两个列表必须各自闭合，不能出现 <ul> 里套 <ol>
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<ol'))
  })

  it('粗体与行内代码', () => {
    const html = renderMarkdownLite('**重点** 和 `code`')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<code class="rounded bg-muted px-1 py-0.5 text-[0.9em]">code</code>')
  })

  it('代码块保留原文，不解析里面的星号', () => {
    const html = renderMarkdownLite('```\nconst a = **b**\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('const a = **b**')
    expect(html).not.toContain('<strong>')
  })

  it('模型输出里的 HTML 会被转义，不会执行', () => {
    const html = renderMarkdownLite('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('只放行 http(s) 链接', () => {
    const ok = renderMarkdownLite('[文档](https://example.com/a)')
    expect(ok).toContain('href="https://example.com/a"')

    const bad = renderMarkdownLite('[点我](javascript:alert(1))')
    expect(bad).not.toContain('href')
  })

  it('引用块与空行', () => {
    const html = renderMarkdownLite('> 一句话\n\n正文')
    expect(html).toContain('<blockquote')
    expect(html).toContain('正文')
  })
})

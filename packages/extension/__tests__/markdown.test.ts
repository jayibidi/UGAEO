import { describe, expect, it } from 'vitest'
import {
  applyHtmlCommand,
  applyMarkdownCommand,
  escapeHtml,
  plainTextOf,
  renderInline,
  renderMarkdown,
} from '../src/console/lib/markdown'

describe('renderMarkdown', () => {
  it('渲染标题层级', () => {
    expect(renderMarkdown('# 一级')).toContain('<h1')
    expect(renderMarkdown('### 三级')).toContain('<h3')
  })

  it('渲染粗体 / 斜体 / 删除线 / 行内代码', () => {
    const html = renderMarkdown('**粗** *斜* ~~删~~ `code`')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<del>删</del>')
    expect(html).toContain('<code')
    expect(html).toContain('code</code>')
  })

  it('行内代码里的星号不参与加粗解析', () => {
    const html = renderInline('`a*b*c`')
    expect(html).toContain('a*b*c')
    expect(html).not.toContain('<em>')
  })

  it('渲染无序列表与有序列表', () => {
    expect(renderMarkdown('- 一\n- 二')).toContain('<ul')
    expect(renderMarkdown('1. 一\n2. 二')).toContain('<ol')
  })

  it('列表不会把后面的文字吞进去', () => {
    const html = renderMarkdown('- 一\n\n正文段落')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<p')
    expect(html).toContain('正文段落')
  })

  it('渲染引用与代码块', () => {
    expect(renderMarkdown('> 引用文字')).toContain('<blockquote')
    const code = renderMarkdown('```\nconst a = 1\n```')
    expect(code).toContain('<pre')
    expect(code).toContain('const a = 1')
  })

  it('渲染图片与链接', () => {
    const html = renderMarkdown('![封面](https://a.com/x.png)\n\n[站点](https://b.com)')
    expect(html).toContain('<img src="https://a.com/x.png"')
    expect(html).toContain('href="https://b.com"')
  })

  it('渲染表格', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
  })

  it('渲染分割线', () => {
    expect(renderMarkdown('---')).toContain('<hr')
  })

  it('段落内的单换行保留为 <br>', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br />')
  })

  it('转义 HTML，不执行注入的标签', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('拦掉 javascript: 链接', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
  })

  it('裸域名补 https', () => {
    expect(renderInline('[站](www.ugooto.cn)')).toContain('href="https://www.ugooto.cn"')
  })

  it('escapeHtml 覆盖五个特殊字符', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })
})

describe('applyMarkdownCommand', () => {
  const base = '正文内容'

  it('加粗选中文本并把光标放在内部', () => {
    const r = applyMarkdownCommand(base, 0, 2, 'bold')
    expect(r.value).toBe('**正文**内容')
    expect(r.value.slice(r.start, r.end)).toBe('正文')
  })

  it('已加粗再点一次会取消', () => {
    const once = applyMarkdownCommand(base, 0, 2, 'bold')
    const twice = applyMarkdownCommand(once.value, once.start, once.end, 'bold')
    expect(twice.value).toBe(base)
  })

  it('光标在加粗文字中间时取消两侧标记', () => {
    const r = applyMarkdownCommand('**正文**', 2, 4, 'bold')
    expect(r.value).toBe('正文')
  })

  it('没选中文字时插入占位符', () => {
    const r = applyMarkdownCommand('', 0, 0, 'bold')
    expect(r.value).toBe('**粗体**')
    expect(r.value.slice(r.start, r.end)).toBe('粗体')
  })

  it('给选中行加二级标题，再点取消', () => {
    const r = applyMarkdownCommand('小标题', 0, 0, 'h2')
    expect(r.value).toBe('## 小标题')
    const back = applyMarkdownCommand(r.value, r.start, r.end, 'h2')
    expect(back.value).toBe('小标题')
  })

  it('多行选区整体加无序列表', () => {
    const r = applyMarkdownCommand('一\n二', 0, 3, 'bullet')
    expect(r.value).toBe('- 一\n- 二')
  })

  it('有序列表按行编号', () => {
    const r = applyMarkdownCommand('一\n二', 0, 3, 'ordered')
    expect(r.value).toBe('1. 一\n2. 二')
  })

  it('引用加 > 前缀', () => {
    const r = applyMarkdownCommand('话', 0, 0, 'quote')
    expect(r.value).toBe('> 话')
  })

  it('链接把选中文字变可点文本', () => {
    const r = applyMarkdownCommand('官网', 0, 2, 'link')
    expect(r.value).toBe('[官网](https://)')
  })

  it('表格与分割线在光标处插入块', () => {
    expect(applyMarkdownCommand('', 0, 0, 'table').value).toContain('| 列 1 |')
    expect(applyMarkdownCommand('', 0, 0, 'hr').value).toContain('---')
  })

  it('块插入前补空行，避免和上一段粘在一起', () => {
    const r = applyMarkdownCommand('上文', 2, 2, 'codeBlock')
    expect(r.value.startsWith('上文\n\n```')).toBe(true)
  })
})

describe('applyHtmlCommand', () => {
  it('包 strong 标签', () => {
    const r = applyHtmlCommand('粗', 0, 1, 'bold')
    expect(r.value).toBe('<strong>粗</strong>')
  })

  it('插入图片标签', () => {
    const r = applyHtmlCommand('', 0, 0, 'image')
    expect(r.value).toBe('<img src="https://" alt="图片说明">')
  })
})

describe('plainTextOf', () => {
  it('去掉标记只留文字', () => {
    const text = plainTextOf('# 标题\n\n**正文** [链接](https://a.com)\n![图](https://a.com/x.png)')
    expect(text).toContain('标题')
    expect(text).toContain('正文')
    expect(text).not.toContain('https://')
    expect(text).not.toContain('#')
  })
})

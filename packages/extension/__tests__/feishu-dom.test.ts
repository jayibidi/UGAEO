import { describe, expect, it } from 'vitest'
import { blockText, renderFeishuDomBlock } from '../src/content/feishu-dom'

/** 造一个够用的元素桩：只需要 getAttribute / querySelector / 文本 */
function stub(
  attrs: Record<string, string>,
  opts: {
    tag?: string
    text?: string
    inner?: string
    img?: { src?: string; 'data-src'?: string }
    code?: string
  } = {}
) {
  const el = {
    tagName: opts.tag || 'DIV',
    getAttribute: (name: string) => attrs[name] ?? null,
    querySelector: (selector: string) => {
      if (selector === 'img') {
        return opts.img
          ? { getAttribute: (n: string) => opts.img?.[n as 'src' | 'data-src'] ?? null }
          : null
      }
      if (opts.code !== undefined) {
        return {
          tagName: 'CODE',
          textContent: opts.code,
          getAttribute: () => null,
          querySelector: () => null,
        }
      }
      return null
    },
    get textContent() {
      return opts.text ?? ''
    },
    get innerText() {
      return opts.inner ?? opts.text ?? ''
    },
  }
  return el as unknown as HTMLElement
}

describe('飞书块 → HTML', () => {
  it('标题按层级映射', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'heading1' }, { text: '一级' }))).toBe('<h1>一级</h1>')
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'heading3' }, { text: '三级' }))).toBe('<h3>三级</h3>')
  })

  it('没有 data-block-type 时按标签名兜底', () => {
    expect(renderFeishuDomBlock(stub({}, { tag: 'H2', text: '小标题' }))).toBe('<h2>小标题</h2>')
  })

  it('列表与引用各自成块', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'bullet' }, { text: '条目' }))).toBe('<ul><li>条目</li></ul>')
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'ordered' }, { text: '第一步' }))).toBe('<ol><li>第一步</li></ol>')
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'quote' }, { text: '引用' }))).toBe(
      '<blockquote><p>引用</p></blockquote>'
    )
  })

  it('分割线直接出 hr', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'divider' }, { text: '' }))).toBe('<hr>')
  })

  it('代码块保留换行并转义尖括号', () => {
    const html = renderFeishuDomBlock(
      stub({ 'data-block-type': 'code' }, { text: '', code: 'if (a < b) {\n  run()\n}' })
    )
    expect(html).toContain('<pre><code>')
    expect(html).toContain('a &lt; b')
    expect(html).toContain('\n')
  })

  it('图片块取 src，拿不到退回 data-src', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'image' }, { text: '', img: { src: 'https://x/a.png' } }))).toBe(
      '<p><img src="https://x/a.png"></p>'
    )
    expect(
      renderFeishuDomBlock(stub({ 'data-block-type': 'image' }, { text: '', img: { 'data-src': 'https://x/b.png' } }))
    ).toBe('<p><img src="https://x/b.png"></p>')
  })

  it('正文里的特殊字符会被转义，多行转 <br>', () => {
    const html = renderFeishuDomBlock(stub({}, { text: 'a & b < c\n第二行' }))
    expect(html).toBe('<p>a &amp; b &lt; c<br>第二行</p>')
  })

  it('空块返回空串，不产出空标签', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'text' }, { text: '   ' }))).toBe('')
  })

  it('表格降级成段落文字（不硬凑表格结构）', () => {
    expect(renderFeishuDomBlock(stub({ 'data-block-type': 'table' }, { text: '单元格文字' }))).toBe('<p>单元格文字</p>')
  })
})

describe('块文本取法', () => {
  it('innerText 有内容时优先用它（保留换行）', () => {
    expect(blockText(stub({}, { text: 'a\nb', inner: 'a\nb' }))).toBe('a\nb')
  })

  it('innerText 缺失时退回 textContent', () => {
    expect(blockText(stub({}, { text: '纯文本' }))).toBe('纯文本')
  })
})

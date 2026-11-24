/**
 * 文章编辑弹窗的渲染冒烟
 *
 * 重点验证三件事：
 * 1. 平台列表跟着发布方式走（立即发布不出现「仅草稿」平台，存为草稿全都在）；
 * 2. 同步页用的 save 模式底部只有取消/保存，没有「保存并重发」；
 * 3. 失败处理页用的 publish 模式仍保留重发按钮。
 *
 * 用 SSR 渲染 + 桩 store：useEffect 不会执行，正好测初始形态。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const holder = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('../src/console/lib/store', () => ({
  useConsoleStore: () => holder.state,
}))

import { EditArticleModal } from '../src/console/components/EditArticleModal'

const platforms = [
  {
    id: 'zhihu',
    name: '知乎',
    icon: '',
    homepage: 'https://www.zhihu.com',
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft', 'publish'],
  },
  {
    id: 'juejin',
    name: '掘金',
    icon: '',
    homepage: 'https://juejin.cn',
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft', 'publish'],
  },
  {
    id: 'douban',
    name: '豆瓣',
    icon: '',
    homepage: 'https://www.douban.com',
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft'],
  },
  {
    id: 'weibo',
    name: '微博',
    icon: '',
    homepage: 'https://weibo.com',
    isAuthenticated: false,
    sourceType: 'dsl',
    capabilities: ['article', 'draft'],
  },
  {
    // 没有文章编辑器的平台：发布模式下列不出来，只能存草稿后人工填写
    id: 'ithome',
    name: 'IT之家',
    icon: '',
    homepage: 'https://www.ithome.com',
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft'],
    noEditor: true,
  },
]

function setState(patch: Record<string, unknown> = {}) {
  holder.state = {
    platforms,
    loadSnapshot: async () => null,
    runSync: async () => [],
    setNotice: () => {},
    ...patch,
  }
}

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(EditArticleModal, {
      open: true,
      onClose: () => {},
      defaultPlatforms: [],
      initialArticle: null,
      ...props,
    })
  )
}

describe('EditArticleModal 平台联动', () => {
  it('立即发布：列出可直发 + AI 自动发布的平台，词条平台给出提示', () => {
    setState()
    const html = render({ defaultMode: 'publish', purpose: 'save' })

    expect(html).toContain('知乎')
    expect(html).toContain('掘金')
    // 豆瓣有编辑器、没有直发接口 → 走 AI 自动发布，能选
    expect(html).toContain('豆瓣')
    // IT之家没有文章编辑器 → 锁在草稿模式
    expect(html).not.toContain('IT之家')
    expect(html).toContain('另有 1 个词条平台（没有文章编辑器）只能存草稿')
    // 未登录平台任何模式下都不该出现
    expect(html).not.toContain('微博')
  })

  it('存为草稿：全部平台都在，含词条平台', () => {
    setState()
    const html = render({ defaultMode: 'draft', purpose: 'save' })

    expect(html).toContain('知乎')
    expect(html).toContain('豆瓣')
    expect(html).toContain('IT之家')
    expect(html).not.toContain('另有')
  })

  it('两种模式都带全选入口', () => {
    setState()
    expect(render({ defaultMode: 'publish', purpose: 'save' })).toContain('全选')
    expect(render({ defaultMode: 'draft', purpose: 'save' })).toContain('全选')
  })
})

describe('EditArticleModal 底部按钮', () => {
  it('save 模式：取消 + 保存，没有重发', () => {
    setState()
    const html = render({ purpose: 'save', defaultMode: 'draft' })

    expect(html).toContain('保存')
    expect(html).not.toContain('保存并重发')
    expect(html).toContain('不必填全也能保存')
  })

  it('publish 模式：保留保存并重发', () => {
    setState()
    const html = render({ purpose: 'publish', defaultMode: 'publish' })

    expect(html).toContain('保存并重发')
  })
})

describe('EditArticleModal 编辑器', () => {
  it('正文区带 Markdown 工具栏与格式切换', () => {
    setState()
    const html = render({ purpose: 'save' })

    expect(html).toContain('加粗')
    expect(html).toContain('Markdown')
    expect(html).toContain('HTML')
    expect(html).toContain('可直接粘贴图片')
  })

  it('新建时正文为空，并给出写作提示', () => {
    setState()
    const html = render({ purpose: 'save', initialArticle: null })

    expect(html).toContain('从这里开始写')
  })
})

describe('EditArticleModal 的 AI 面板', () => {
  it('正文上方有「文案 / 配图」两个模式与对应提示语', () => {
    setState()
    const html = render({ purpose: 'save' })

    expect(html).toContain('文案')
    expect(html).toContain('配图')
    expect(html).toContain('输入标题或提示词，让 AI 帮你生成文稿…')
    // 篇幅档位只在文案模式下有意义
    expect(html).toContain('篇幅')
  })

  it('文案模式默认不提交（没输入内容，按钮禁用）', () => {
    setState()
    const html = render({ purpose: 'save' })
    const sendButton = html.match(/<button[^>]*title="生成（Enter 发送[^>]*>/)
    expect(sendButton?.[0]).toContain('disabled')
  })
})

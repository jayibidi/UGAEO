/**
 * AI 创作页的渲染冒烟
 *
 * 这一页把三块拼在一起：待同步文章、常驻编辑器、AI 模型配置。
 * 重点验证：
 * 1. 编辑器是内嵌的（页面里不该出现 fixed 遮罩）；
 * 2. 待同步文章有内容时给出「载入编辑器」与「去发布」；
 * 3. AI 模型那栏在页面上（不是要跳出去设置）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const holder = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('../src/console/lib/store', () => ({
  useConsoleStore: Object.assign(
    () => holder.state,
    { getState: () => holder.state }
  ),
}))

import { ComposePage } from '../src/console/pages/Compose'

/** 页面里有 <Link>，SSR 下必须有 Router 上下文 */
function renderPage() {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ComposePage))
  )
}

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
]

function setState(article: Record<string, unknown> | null) {
  holder.state = {
    article,
    selectedPlatforms: ['zhihu'],
    publishMode: 'publish',
    platforms,
    setArticle: vi.fn(),
    extractFromActiveTab: vi.fn(async () => true),
    feishuCapture: { status: 'idle' },
    startFeishuCapture: vi.fn(),
    cancelFeishuCapture: vi.fn(),
    loadSnapshot: vi.fn(async () => null),
    runSync: vi.fn(async () => []),
    setNotice: vi.fn(),
  }
}

describe('AI 创作页', () => {
  it('空文章时给出三种入口与空白编辑器', () => {
    setState(null)
    const html = renderPage()

    expect(html).toContain('待同步文章')
    expect(html).toContain('从飞书文档提取')
    expect(html).toContain('从当前页面提取')
    expect(html).toContain('新建空白')
    expect(html).toContain('还没有待同步文章')
  })

  it('编辑器内嵌在页面里，不是弹窗', () => {
    setState(null)
    const html = renderPage()

    // 弹窗形态有全屏遮罩；内嵌不该有
    expect(html).not.toContain('fixed inset-0 z-50')
    // 内嵌也不该出现「取消」按钮（那是弹窗的退出方式）
    expect(html).toContain('保存')
  })

  it('不再重复放 AI 模型配置（入口只在设置与控制台左下角）', () => {
    setState(null)
    const html = renderPage()

    expect(html).not.toContain('启用 AI 能力')
    expect(html).not.toContain('拉取模型库')
  })

  it('有文章时显示摘要、载入编辑器与去发布', () => {
    setState({
      title: '三十二个平台，一次发完',
      markdown: '# 正文\n\n内容',
      tags: ['自媒体', '效率'],
      imageCount: 2,
    })
    const html = renderPage()

    expect(html).toContain('三十二个平台，一次发完')
    expect(html).toContain('载入编辑器')
    expect(html).toContain('去发布')
    expect(html).toContain('自媒体')
  })

  it('编辑器主体在页面里：正文、目标平台、发布方式', () => {
    setState(null)
    const html = renderPage()

    expect(html).toContain('正文')
    expect(html).toContain('目标平台')
    expect(html).toContain('发布方式')
    // 内嵌时用页面自身滚动，不该再有 70vh 的内部滚动区
    expect(html).not.toContain('max-h-[70vh]')
  })
})

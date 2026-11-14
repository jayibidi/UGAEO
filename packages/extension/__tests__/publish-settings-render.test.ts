/**
 * 发布设置的渲染冒烟
 *
 * 这里只验证「两个页签渲染出来的东西确实不一样」——
 * 这正是这次要修的问题：以前两个页签内容完全一致。
 *
 * 注意：SSR 渲染时 zustand 只会读到初始状态，所以这里把 store 整体替换成桩，
 * 直接给定要验证的那份状态。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const holder = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('../src/console/lib/store', () => ({
  useConsoleStore: () => holder.state,
}))

import { PublishSettings } from '../src/console/components/PublishSettings'

const basePlatforms = [
  {
    id: 'zhihu',
    name: '知乎',
    icon: '',
    homepage: 'https://www.zhihu.com',
    isAuthenticated: true,
    sourceType: 'dsl',
    capabilities: ['article', 'draft', 'publish', 'publish_existing_draft'],
  },
  {
    id: 'sohu',
    name: '搜狐号',
    icon: '',
    homepage: 'https://mp.sohu.com',
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
]

function setState(patch: Record<string, unknown>) {
  holder.state = {
    article: { title: '一篇文章', markdown: '# hi' },
    platforms: basePlatforms,
    selectedPlatforms: ['zhihu', 'sohu'],
    publishMode: 'draft',
    publishTiming: 'now',
    scheduledAt: '2026-11-13T10:00',
    draftRefs: [],
    selectedDraftRefs: [],
    scheduledJobs: [],
    lastRunKind: null,
    sync: { running: false, syncId: null, results: [], stages: {}, error: null },
    setPublishMode: () => {},
    setPublishTiming: () => {},
    setScheduledAt: () => {},
    toggleDraftRef: () => {},
    carryDrafts: () => {},
    clearDraftRefs: () => {},
    startSync: () => {},
    publishSelectedDrafts: () => {},
    setNotice: () => {},
    ...patch,
  }
}

function render(): string {
  return renderToStaticMarkup(createElement(PublishSettings))
}

describe('PublishSettings 两个页签', () => {
  it('存为草稿：强调只写草稿箱，不出现定时时间选择', () => {
    setState({ publishMode: 'draft' })
    const html = render()

    expect(html).toContain('不会公开发布')
    expect(html).toContain('全部存草稿')
    expect(html).toContain('同步为草稿 · 2 个平台')
    expect(html).not.toContain('datetime-local')
  })

  it('立即发布：给出立即/定时切换，定时时出现时间输入', () => {
    setState({ publishMode: 'publish', publishTiming: 'schedule' })
    const html = render()

    expect(html).toContain('定时发布')
    expect(html).toContain('datetime-local')
    expect(html).toContain('定时发布到 2 个平台')
    expect(html).not.toContain('全部存草稿')
  })

  it('立即发布：只统计可直发平台，仅草稿平台不计入', () => {
    setState({ publishMode: 'publish', publishTiming: 'now', selectedPlatforms: ['zhihu', 'douban'] })
    const html = render()

    expect(html).toContain('已选 1 个可发布平台')
    expect(html).toContain('另外 1 个所选平台不支持自动发布')
    expect(html).toContain('发布到 1 个平台')
  })

  it('带入草稿：列出草稿并区分能否自动发布', () => {
    setState({
      publishMode: 'publish',
      draftRefs: [
        { platform: 'zhihu', platformName: '知乎', postId: '1', postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' },
        { platform: 'sohu', platformName: '搜狐号', postId: '2', postUrl: 'https://mp.sohu.com/2' },
      ],
      selectedDraftRefs: ['zhihu'],
    })
    const html = render()

    expect(html).toContain('待发布草稿 2 篇')
    expect(html).toContain('可自动发布')
    expect(html).toContain('需手动发布')
    expect(html).toContain('打开草稿')
    expect(html).toContain('发布选中的 1 篇草稿')
  })
})

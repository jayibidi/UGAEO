/**
 * 自检页渲染冒烟
 *
 * 这个页面依赖 background 消息，跑不了完整的端到端；
 * 这里只做 SSR 静态渲染，确认组件树、图标与类型在构建后不会直接炸掉。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiagnosticsPage } from '../src/console/pages/Diagnostics'

describe('DiagnosticsPage', () => {
  it('可以静态渲染出标题与体检说明', () => {
    const html = renderToStaticMarkup(createElement(DiagnosticsPage))
    expect(html).toContain('平台自检')
    expect(html).toContain('轻量体检')
    expect(html).toContain('深度体检')
  })
})

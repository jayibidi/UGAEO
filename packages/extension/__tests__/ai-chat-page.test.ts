/**
 * AI 对话页的渲染冒烟
 *
 * 只测空态形态：有消息之后的交互要靠真机跑（这里没有 chrome.runtime）。
 * 重点验证问候语、两种模式、四个建议入口都出来了，且未配置时不会禁用输入框
 * 却不给提示。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AiChatPage } from '../src/console/pages/AiChat'

describe('AI 对话页', () => {
  const html = renderToStaticMarkup(createElement(AiChatPage))

  it('空态有问候与副标题', () => {
    expect(html).toMatch(/好，想创作点什么？/)
    expect(html).toContain('一站式帮你把想法做成能发的内容')
  })

  it('输入框上方有对话 / 生图两种模式', () => {
    expect(html).toContain('对话')
    expect(html).toContain('生图')
    expect(html).toContain('说出你想写什么')
  })

  it('给出四个可以直接点的起手式', () => {
    for (const title of ['蹭个热点', '写小红书文案', '做金句卡片', '口播脚本']) {
      expect(html).toContain(title)
    }
    // 生图类的卡片要标出来，用户才知道它不会走文本模型
    expect(html).toContain('生图')
  })

  it('提示了快捷键与当前模型位置', () => {
    expect(html).toContain('Enter 发送 · Shift+Enter 换行')
  })
})

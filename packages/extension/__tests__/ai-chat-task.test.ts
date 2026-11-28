import { describe, expect, it } from 'vitest'
import { buildChatMessages } from '../src/background/ai-service'

describe('AI 对话的消息组装', () => {
  it('默认人设放最前面，历史顺序原样保留', () => {
    const messages = buildChatMessages({
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
      ],
    })

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('内容创作助手')
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ])
  })

  it('调用方给了 system 就用它，不再拼默认人设', () => {
    const messages = buildChatMessages({
      messages: [{ role: 'user', content: '在吗' }],
      system: '你是一只猫，只会喵。',
    })

    expect(messages[0].content).toBe('你是一只猫，只会喵。')
    expect(messages[0].content).not.toContain('内容创作助手')
  })

  it('空白的人设回退到默认，不会发出空的 system', () => {
    const messages = buildChatMessages({
      messages: [{ role: 'user', content: '在吗' }],
      system: '   ',
    })
    expect(messages[0].content).not.toBe('')
    expect(messages[0].content).toContain('内容创作助手')
  })

  it('空内容的消息被丢掉（否则接口会 400）', () => {
    const messages = buildChatMessages({
      messages: [
        { role: 'user', content: '有内容' },
        { role: 'assistant', content: '' },
        { role: 'user', content: '   ' },
        { role: 'assistant', content: '也有内容' },
      ],
    })

    expect(messages).toHaveLength(3)
    expect(messages.map(m => m.content).slice(1)).toEqual(['有内容', '也有内容'])
  })
})

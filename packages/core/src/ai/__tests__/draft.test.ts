/**
 * 从提示词生成整篇稿
 *
 * 编辑器里用户可能只填标题、也可能写一段开放式描述，模型输出还经常不守 JSON 约定。
 * 这里锁的是「怎么烂都要能用」：
 * - 提示词必须把标题长度、摘要字数、标签数量、篇幅写清楚；
 * - 解析失败（模型直接吐 Markdown）→ 正文照用，标题从小节标题里取；
 * - 标签必须去掉 #、去重、限量。
 */
import { describe, expect, it } from 'vitest'
import { draftPrompt, parseDraft } from '../draft'

describe('draftPrompt', () => {
  it('把用户输入与硬性约束都写进提示词', () => {
    const prompt = draftPrompt({ prompt: '写一篇关于 AEO 的科普', length: 'short' })
    expect(prompt).toContain('写一篇关于 AEO 的科普')
    expect(prompt).toContain('不超过 30 字')
    expect(prompt).toContain('60~100 字')
    expect(prompt).toContain('600~900 字')
    expect(prompt).toContain('只输出 JSON')
  })

  it('已有标题时一并给模型，要求沿用', () => {
    const prompt = draftPrompt({ prompt: '补充内容', title: '三十二个平台一次发完' })
    expect(prompt).toContain('三十二个平台一次发完')
    expect(prompt).toContain('已有标题')
  })
})

describe('parseDraft', () => {
  it('解析标准 JSON 输出', () => {
    const raw = JSON.stringify({
      title: '三十二个平台一次发完',
      summary: '把重复劳动交给脚本。',
      tags: ['内容分发', '效率工具'],
      markdown: '## 为什么\n\n因为手动太慢。',
    })

    const result = parseDraft(raw)
    expect(result).toEqual({
      title: '三十二个平台一次发完',
      summary: '把重复劳动交给脚本。',
      tags: ['内容分发', '效率工具'],
      markdown: '## 为什么\n\n因为手动太慢。',
    })
  })

  it('兼容代码块包裹与前后解释文字', () => {
    const raw = '好的，下面是文章：\n```json\n{"title":"标题","summary":"摘要","tags":["a"],"markdown":"正文"}\n```'
    const result = parseDraft(raw)
    expect(result?.title).toBe('标题')
    expect(result?.markdown).toBe('正文')
  })

  it('标签去掉 # 号并限量 6 个', () => {
    const raw = JSON.stringify({
      title: 't',
      summary: 's',
      tags: ['#效率', '效率', '工具', '内容', '分发', '运营', '增长', '额外'],
      markdown: '正文',
    })
    const result = parseDraft(raw)
    expect(result?.tags[0]).toBe('效率')
    expect(result?.tags.length).toBeLessThanOrEqual(6)
  })

  it('模型直接吐 Markdown 时也能用：标题取小节标题、摘要取自正文', () => {
    const raw = '## 先说结论\n\n手动发三十二个平台是纯体力活。\n\n## 怎么做\n\n交给脚本。'
    const result = parseDraft(raw, 'AEO 分发')

    expect(result?.title).toBe('先说结论')
    expect(result?.markdown).toContain('手动发三十二个平台')
    expect(result?.summary).toContain('手动发三十二个平台')
    expect(result?.tags).toEqual([])
  })

  it('正文为空时返回 null', () => {
    expect(parseDraft('')).toBeNull()
    expect(parseDraft('{"title":"只有标题"}')).toBeNull()
  })
})

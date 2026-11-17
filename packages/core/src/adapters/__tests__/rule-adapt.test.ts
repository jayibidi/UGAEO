import { describe, expect, it } from 'vitest'
import {
  adaptTitle,
  countChars,
  effectiveTitleMax,
  titleFromBody,
  truncateTitle,
} from '../rule-adapt'
import { PLATFORM_RULES, getPlatformRule, platformPreconditions } from '../platform-rules'

describe('字符计数', () => {
  it('按码点算，emoji 记 1 个', () => {
    expect(countChars('中文标题')).toBe(4)
    expect(countChars('😀')).toBe(1)
    expect(countChars('')).toBe(0)
  })
})

describe('标题截断', () => {
  it('不超长时原样返回', () => {
    expect(truncateTitle('短标题', 20)).toBe('短标题')
  })

  it('优先断在标点处，读起来是一句完整的话', () => {
    const title = '用飞书排版再一键同步到三十四个平台，这次终于不用每个平台再改一遍了'
    const out = truncateTitle(title, 20)
    expect(countChars(out)).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
    // 断在逗号前，不带多余的标点
    expect(out).toBe('用飞书排版再一键同步到三十四个平台…')
  })

  it('没有标点时硬切，但不把英文单词切一半', () => {
    const out = truncateTitle('kubernetes observability best practices for teams', 24)
    expect(countChars(out)).toBeLessThanOrEqual(24)
    expect(out.endsWith('…')).toBe(true)
    // 不能出现半个单词（末尾不能是孤立的字母碎片）
    const body = out.replace('…', '').trimEnd()
    expect(body.endsWith('kubernetes') || body.endsWith('observability') || body.endsWith('best')).toBe(true)
  })
})

describe('从正文取标题', () => {
  it('跳过代码块与图片，取第一个像话的句子', () => {
    const body = '```js\nconst a = 1\n```\n\n![图](data:image/png;base64,x)\n\n这次我们把同步链路重做了一遍，速度提升明显。'
    expect(titleFromBody(body, 30)).toContain('同步链路')
  })

  it('正文为空时返回空串', () => {
    expect(titleFromBody('', 30)).toBe('')
    expect(titleFromBody('   \n\n  ', 30)).toBe('')
  })
})

describe('按平台适配标题', () => {
  it('合规的标题不动', () => {
    const out = adaptTitle('xiaohongshu', '三个方法提升同步效率', '', getPlatformRule('xiaohongshu'))
    expect(out.action).toBe('unchanged')
    expect(out.adapted).toBe('三个方法提升同步效率')
    expect(out.needsAI).toBe(false)
  })

  it('超长标题按平台上限截断，并标记需要 AI 改写', () => {
    const out = adaptTitle(
      'xiaohongshu',
      '我用这套方法把三十四个平台的发布流程压缩到了十分钟，附完整清单和踩坑记录',
      '',
      getPlatformRule('xiaohongshu')
    )
    expect(out.action).toBe('truncated')
    expect(countChars(out.adapted)).toBeLessThanOrEqual(20)
    expect(out.needsAI).toBe(true)
    expect(out.note).toContain('→')
  })

  it('空标题从正文首句补一个', () => {
    const out = adaptTitle('zhihu', '', '这篇文章讲清楚了三件事，第一是规则。', getPlatformRule('zhihu'))
    expect(out.action).toBe('from-body')
    expect(out.adapted).toContain('三件事')
  })

  it('微博去掉书名号', () => {
    const out = adaptTitle('weibo', '《深度长文》同步工具怎么选', '', getPlatformRule('weibo'))
    expect(out.adapted).toBe('深度长文同步工具怎么选')
    expect(out.action).toBe('stripped')
  })

  it('没登记规则的平台原样放行', () => {
    const out = adaptTitle('unknown-platform', '任意长度的标题都不改', '', getPlatformRule('unknown-platform'))
    expect(out.action).toBe('unchanged')
    expect(out.needsAI).toBe(false)
  })
})

describe('规则表本身', () => {
  it('小红书 20 字、B站 40 字这类硬限制在表里', () => {
    expect(PLATFORM_RULES.xiaohongshu.titleMax).toBe(20)
    expect(PLATFORM_RULES.bilibili.titleMax).toBe(40)
    expect(PLATFORM_RULES.weixin.summaryMax).toBe(120)
  })

  it('每个登记的平台都有 AI 用的风格描述（否则 AI 改写没方向）', () => {
    for (const [id, rule] of Object.entries(PLATFORM_RULES)) {
      expect(rule.titleStyle, id).toBeTruthy()
      expect(rule.titleIdeal, id).toBeTruthy()
      expect(rule.titleIdeal![0]).toBeLessThan(rule.titleIdeal![1])
    }
  })

  it('有效上限优先取硬限制，其次取建议区间上界', () => {
    expect(effectiveTitleMax({ titleMax: 40, titleIdeal: [10, 20] })).toBe(40)
    expect(effectiveTitleMax({ titleIdeal: [10, 25] })).toBe(25)
    expect(effectiveTitleMax({})).toBeUndefined()
  })

  it('只给确实需要人工准备的平台挂前置条件', () => {
    expect(platformPreconditions('ithome').length).toBeGreaterThan(0)
    expect(platformPreconditions('zhihu')).toEqual([])
  })
})

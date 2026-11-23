/**
 * AI 发布计划：提示词与解析
 *
 * 锁死三件事：
 * 1. 提示词必须把平台的硬约束（标题上限、标签数）说清楚，且要求纯 JSON；
 * 2. 模型多写一句「好的，下面是」也要能解析出来；
 * 3. 解析失败 / 标题超长时不能让自动发布整体失败 —— 要么截断，要么返回 null
 *    让调用方退回规则标题。
 */
import { describe, expect, it } from 'vitest'
import { parsePublishBrief, publishBriefPrompt, tagCountFor } from '../publish-brief'

const INPUT = {
  title: '我用这套方法把三十二个平台的发布压缩到十分钟',
  content: '正文节选……',
  platformId: 'xiaohongshu',
  platformName: '小红书',
  titleMax: 20,
  tagCount: 8,
  summaryMax: 100,
  styleHint: '小红书：口语化、有获得感',
}

describe('publishBriefPrompt', () => {
  it('把平台名、标题上限、标签数量都写进提示词', () => {
    const prompt = publishBriefPrompt(INPUT)
    expect(prompt).toContain('小红书')
    expect(prompt).toContain('不超过 20 个字')
    expect(prompt).toContain('8 个话题词')
    expect(prompt).toContain('不超过 100 个字')
    expect(prompt).toContain('小红书：口语化、有获得感')
  })

  it('要求只输出 JSON，避免一段解释性开场白', () => {
    const prompt = publishBriefPrompt(INPUT)
    expect(prompt).toContain('只输出一个 JSON 对象')
    expect(prompt).toContain('{"title"')
  })

  it('该平台不用标签时明确要求空数组', () => {
    const prompt = publishBriefPrompt({ ...INPUT, tagCount: 0 })
    expect(prompt).toContain('返回空数组')
    expect(prompt).not.toContain('8 个话题词')
  })
})

describe('parsePublishBrief', () => {
  it('解析标准 JSON', () => {
    const brief = parsePublishBrief(
      '{"title":"十分钟发完三十二个平台","summary":"一套自动发布流程。","tags":["#内容运营","效率工具"]}',
      { title: INPUT.title, titleMax: 20, tagCount: 8 }
    )
    expect(brief).not.toBeNull()
    expect(brief!.title).toBe('十分钟发完三十二个平台')
    expect(brief!.summary).toBe('一套自动发布流程。')
    // 模型爱带 # 号，这里统一去掉
    expect(brief!.tags).toEqual(['内容运营', '效率工具'])
  })

  it('模型多写一句开场白也能解析', () => {
    const raw = '好的，下面是结果：\n{"title":"十分钟发完","summary":"摘要","tags":["A"]}'
    const brief = parsePublishBrief(raw, { title: '原', titleMax: 20 })
    expect(brief?.title).toBe('十分钟发完')
    expect(brief?.tags).toEqual(['A'])
  })

  it('标题超过平台上限时截断（模型经常多给两三个字）', () => {
    const brief = parsePublishBrief('{"title":"这是一个明显超过二十个字上限的小红书标题内容","summary":"","tags":[]}', {
      title: '原',
      titleMax: 20,
    })
    expect(brief!.title.length).toBe(20)
  })

  it('标题为空时退回原标题', () => {
    const brief = parsePublishBrief('{"title":"","summary":"摘要","tags":["A"]}', { title: '原标题', titleMax: 20 })
    expect(brief?.title).toBe('原标题')
  })

  it('标签过多 / 过长会被裁掉', () => {
    const brief = parsePublishBrief(
      '{"title":"标题","summary":"","tags":["一","二二","三个字","四个字啊","这是一个非常长的标签词","六"]}',
      { title: '原', titleMax: 20, tagCount: 3 }
    )
    expect(brief!.tags).toHaveLength(3)
    expect(brief!.tags.every(tag => tag.length <= 12)).toBe(true)
  })

  it('完全解析不出来时返回 null，让调用方退回规则标题', () => {
    expect(parsePublishBrief('抱歉，我无法完成这个任务。', { title: '原' })).toBeNull()
  })

  it('返回的 tags 去重', () => {
    const brief = parsePublishBrief('{"title":"标题","summary":"","tags":["运营","运营","效率"]}', { title: '原' })
    expect(brief!.tags).toEqual(['运营', '效率'])
  })
})

describe('tagCountFor', () => {
  it('小红书要 8 个、微博只要 3 个、未知平台按 4 个', () => {
    expect(tagCountFor('xiaohongshu')).toBe(8)
    expect(tagCountFor('weibo')).toBe(3)
    expect(tagCountFor('no-such-platform')).toBe(4)
  })
})

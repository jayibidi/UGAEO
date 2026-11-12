import { describe, expect, it } from 'vitest'
import {
  CONTENT_KIND_LABEL,
  PLATFORM_PROFILES,
  countByContentKind,
  getPlatformProfile,
  groupByPublishLayer,
  resolvePublishLayer,
} from '../platform-profiles'
import {
  BafangAdapter,
  BaiduZhidaoAdapter,
  Huangye88Adapter,
  HuxiuAdapter,
  InfoqAdapter,
  IthomeAdapter,
  JianshuAdapter,
  JiemianAdapter,
  Kr36Adapter,
  KuaidongAdapter,
  NeteaseAdapter,
  ShunqiAdapter,
  SmzdmAdapter,
  TencentOmAdapter,
} from '../platforms'

/** 2.4.0 新增的 14 个平台 */
const NEW_PLATFORMS = [
  'netease',
  'tencent-om',
  'kr36',
  'huxiu',
  'jiemian',
  'jianshu',
  'smzdm',
  'shunqi',
  'bafang',
  'huangye88',
  'baiduzhidao',
  'ithome',
  'infoq',
  'kuaidong',
]

/** 2.3.x 及之前已接入的平台 */
const EXISTING_PLATFORMS = [
  'zhihu',
  'juejin',
  'csdn',
  'cnblogs',
  'oschina',
  'segmentfault',
  '51cto',
  'imooc',
  'woshipm',
  'yuque',
  'douban',
  'weixin',
  'xiaohongshu',
  'bilibili',
  'weibo',
  'baijiahao',
  'sohu',
  'xueqiu',
  'eastmoney',
  'toutiao',
]

describe('平台分类表', () => {
  it('新增平台全部登记了内容形态标签', () => {
    for (const id of NEW_PLATFORMS) {
      const profile = PLATFORM_PROFILES[id]
      expect(profile, `缺少 ${id} 的档案`).toBeTruthy()
      expect(['graphic', 'news']).toContain(profile.kind)
    }
  })

  it('现有平台同样带标签，不需要改适配器文件', () => {
    for (const id of EXISTING_PLATFORMS) {
      const profile = PLATFORM_PROFILES[id]
      expect(profile, `缺少 ${id} 的档案`).toBeTruthy()
      expect(CONTENT_KIND_LABEL[profile.kind]).toBeTruthy()
    }
  })

  it('未知平台有默认标签，界面不会出现空白标签', () => {
    const profile = getPlatformProfile('some-future-platform')
    expect(profile.kind).toBe('graphic')
    expect(CONTENT_KIND_LABEL[profile.kind]).toBe('图文类')
  })
})

describe('发布层级推导', () => {
  it('声明了 publish 能力的平台归入可直发', () => {
    expect(resolvePublishLayer({ id: 'netease', capabilities: ['article', 'publish'] })).toBe('direct')
    expect(resolvePublishLayer({ id: 'jianshu', capabilities: ['article', 'publish'] })).toBe('direct')
  })

  it('没有 publish 能力的平台归入仅草稿', () => {
    expect(resolvePublishLayer({ id: 'ithome', capabilities: ['article', 'draft'] })).toBe('draft')
    expect(resolvePublishLayer({ id: 'infoq', capabilities: ['article', 'draft'] })).toBe('draft')
    // 百度知道是问答形态，虽然名单里算「可注册可发布」，但落地只能是人工提交
    expect(resolvePublishLayer({ id: 'baiduzhidao', capabilities: ['article', 'draft'] })).toBe('draft')
  })

  it('能力里没有 publish 时不会被档案表误升级成可直发', () => {
    // 档案表只有 kind/order，不含 layer 覆盖，层级永远以能力为准
    expect(resolvePublishLayer({ id: 'kuaidong', capabilities: [] })).toBe('draft')
  })
})

describe('分层分组', () => {
  const platforms = [
    { id: 'ithome', name: 'IT之家', capabilities: ['article', 'draft'] },
    { id: 'shunqi', name: '顺企网', capabilities: ['article', 'publish'] },
    { id: 'netease', name: '网易号', capabilities: ['article', 'publish'] },
    { id: 'kuaidong', name: '快懂百科', capabilities: ['article', 'draft'] },
    { id: 'jianshu', name: '简书', capabilities: ['article', 'publish'] },
  ]

  it('分成两层，可直发在前', () => {
    const { direct, draft } = groupByPublishLayer(platforms)
    expect(direct.map(p => p.id)).toEqual(['netease', 'jianshu', 'shunqi'])
    expect(draft.map(p => p.id)).toEqual(['ithome', 'kuaidong'])
  })

  it('组内按接入优先级排序，自助注册的平台排在申请制前面', () => {
    const { direct } = groupByPublishLayer(platforms)
    // netease(10) < jianshu(12) < shunqi(30)
    expect(direct[0].id).toBe('netease')
    expect(direct[direct.length - 1].id).toBe('shunqi')
  })

  it('本地导出工具不参与平台分层', () => {
    const { direct, draft } = groupByPublishLayer([
      { id: 'zip-download', name: 'Markdown 压缩包', capabilities: ['article'] },
      { id: 'jianshu', name: '简书', capabilities: ['article', 'publish'] },
    ])
    expect(direct.map(p => p.id)).toEqual(['jianshu'])
    expect(draft.map(p => p.id)).toEqual([])
  })
})

describe('内容形态统计', () => {
  it('按图文 / 资讯分别计数', () => {
    const counts = countByContentKind([
      { id: 'jianshu' },
      { id: 'smzdm' },
      { id: 'netease' },
      { id: 'kr36' },
    ])
    expect(counts).toEqual({ graphic: 2, news: 2 })
  })
})

describe('新增适配器与分类表一致', () => {
  /** [适配器类, 预期平台 id, 预期层级] */
  const CASES = [
    [NeteaseAdapter, 'netease', 'direct'],
    [TencentOmAdapter, 'tencent-om', 'direct'],
    [Kr36Adapter, 'kr36', 'direct'],
    [HuxiuAdapter, 'huxiu', 'direct'],
    [JiemianAdapter, 'jiemian', 'direct'],
    [JianshuAdapter, 'jianshu', 'direct'],
    [SmzdmAdapter, 'smzdm', 'direct'],
    [ShunqiAdapter, 'shunqi', 'direct'],
    [BafangAdapter, 'bafang', 'direct'],
    [Huangye88Adapter, 'huangye88', 'direct'],
    [BaiduZhidaoAdapter, 'baiduzhidao', 'draft'],
    [IthomeAdapter, 'ithome', 'draft'],
    [InfoqAdapter, 'infoq', 'draft'],
    [KuaidongAdapter, 'kuaidong', 'draft'],
  ] as const

  it('14 个新增平台的 meta.id 都在分类表里', () => {
    for (const [Adapter, expectedId] of CASES) {
      const adapter = new (Adapter as new () => { meta: { id: string; name: string } })()
      expect(adapter.meta.id).toBe(expectedId)
      expect(PLATFORM_PROFILES[expectedId], `${expectedId} 缺档案`).toBeTruthy()
    }
  })

  it('层级与设计一致：10 个可直发、4 个仅草稿', () => {
    const actual = CASES.map(([Adapter, , layer]) => {
      const adapter = new (Adapter as new () => {
        meta: { id: string; capabilities: string[] }
      })()
      return [adapter.meta.id, resolvePublishLayer(adapter.meta), layer]
    })

    for (const [id, got, want] of actual) {
      expect(got, `${id} 层级不符`).toBe(want)
    }
    // 百度知道是问答形态、没有文章编辑器，从名单里的「可直发」降到「仅草稿」
    expect(actual.filter(([, got]) => got === 'direct')).toHaveLength(10)
    expect(actual.filter(([, got]) => got === 'draft')).toHaveLength(4)
  })

  it('每个新增平台都带内容形态标签', () => {
    for (const [Adapter] of CASES) {
      const adapter = new (Adapter as new () => { meta: { id: string } })()
      expect(CONTENT_KIND_LABEL[getPlatformProfile(adapter.meta.id).kind]).toBeTruthy()
    }
  })
})

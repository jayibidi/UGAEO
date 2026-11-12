/**
 * 平台档案（分类标签唯一真源）
 *
 * 分两个维度打标签，互不替代：
 * - 内容形态 kind：图文类 / 资讯类 —— 只作为账号卡片上的标签展示
 * - 发布能力 layer：可直发 / 仅草稿 —— 决定账号页的层级分组（第一层 / 第二层）
 *
 * layer 不在这里写死，而是由适配器 meta.capabilities 是否包含 'publish' 推导，
 * 避免「标签说能直发、代码实际只存草稿」这种不一致。
 *
 * 现有平台（2.3.x 之前接入的）不改适配器文件，靠这张表补标签；
 * 新增平台同样登记在这里，保证所有平台都带双标签。
 */

/** 内容形态 */
export type ContentKind = 'graphic' | 'news'

/** 发布能力层级 */
export type PublishLayer = 'direct' | 'draft'

export interface PlatformProfile {
  /** 内容形态：图文类 / 资讯类 */
  kind: ContentKind
  /** 同层内排序，越小越靠前（现有平台保持 100，新增按优先级排） */
  order?: number
  /** 接入备注：注册方式、审核形态等，展示在账号页 tooltip */
  note?: string
}

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  graphic: '图文类',
  news: '资讯类',
}

export const PUBLISH_LAYER_LABEL: Record<PublishLayer, string> = {
  direct: '可直发',
  draft: '仅草稿',
}

/**
 * 平台档案
 *
 * 说明：`order` 只在同层内生效，用于把「自助注册 + 有明确发布按钮」的
 * 平台排在前面，申请制 / 投稿制的排在后面。
 */
export const PLATFORM_PROFILES: Record<string, PlatformProfile> = {
  // ── 现有平台（已接入，仅补标签） ──
  zhihu: { kind: 'graphic', order: 100 },
  juejin: { kind: 'graphic', order: 100 },
  csdn: { kind: 'graphic', order: 100 },
  cnblogs: { kind: 'graphic', order: 100 },
  oschina: { kind: 'graphic', order: 100 },
  segmentfault: { kind: 'graphic', order: 100 },
  '51cto': { kind: 'graphic', order: 100 },
  imooc: { kind: 'graphic', order: 100 },
  woshipm: { kind: 'graphic', order: 100 },
  yuque: { kind: 'graphic', order: 100 },
  douban: { kind: 'graphic', order: 100 },
  weixin: { kind: 'graphic', order: 100 },
  xiaohongshu: { kind: 'graphic', order: 100 },
  bilibili: { kind: 'graphic', order: 100 },
  weibo: { kind: 'news', order: 100 },
  baijiahao: { kind: 'news', order: 100 },
  sohu: { kind: 'news', order: 100 },
  xueqiu: { kind: 'news', order: 100 },
  eastmoney: { kind: 'news', order: 100 },
  toutiao: { kind: 'news', order: 100 },
  /** 本地导出工具，不是内容平台，账号页不参与分层 */
  'zip-download': { kind: 'graphic', order: 999, note: '本地导出工具，无需登录' },

  // ── 新增 · 第一层 · 可直发 ──
  netease: { kind: 'news', order: 10, note: '手机号自助注册，需实名；先审后发' },
  'tencent-om': { kind: 'news', order: 11, note: 'QQ / 微信登录，自助开通企鹅号' },
  jianshu: { kind: 'graphic', order: 12, note: '手机号自助注册，发布即时可见' },
  smzdm: { kind: 'graphic', order: 13, note: '手机号自助注册，需实名；发布后审核' },
  kr36: { kind: 'news', order: 20, note: '申请入驻，审核通过后可在创作者后台发布' },
  huxiu: { kind: 'news', order: 21, note: '申请入驻，审核较严；编辑择优推荐' },
  jiemian: { kind: 'news', order: 22, note: '申请制，财经号需公众号运营满 30 天；后台投稿后仍经编辑审核' },
  shunqi: { kind: 'news', order: 30, note: '免费注册企业账号，B2B 企业资讯' },
  bafang: { kind: 'news', order: 31, note: '免费注册，B2B 企业资讯' },
  huangye88: { kind: 'news', order: 32, note: '免费注册，B2B 企业资讯' },

  // ── 新增 · 第二层 · 仅草稿 ──
  baiduzhidao: { kind: 'graphic', order: 50, note: '问答形态，无文章编辑器；打开提问页后需人工提交' },
  ithome: { kind: 'news', order: 40, note: '投稿制，无自助发布后台，只能填入投稿表单' },
  infoq: { kind: 'news', order: 41, note: '投稿制，编辑审核后发布' },
  kuaidong: { kind: 'graphic', order: 42, note: '词条编辑流程，提交后等审核' },
}

/** 未知平台走这个默认档案，保证界面永远有标签可显示 */
const DEFAULT_PROFILE: PlatformProfile = { kind: 'graphic', order: 100 }

export function getPlatformProfile(platformId: string): PlatformProfile {
  return PLATFORM_PROFILES[platformId] || DEFAULT_PROFILE
}

export function contentKindLabel(platformId: string): string {
  return CONTENT_KIND_LABEL[getPlatformProfile(platformId).kind]
}

/**
 * 发布层级：以适配器声明为准
 *
 * 能力里没有 'publish' 的平台一律归入「仅草稿」，
 * 这类平台即使点了「立即发布」，实际也只会把内容填进编辑器。
 */
export function resolvePublishLayer(meta: { id: string; capabilities?: string[] }): PublishLayer {
  const profile = PLATFORM_PROFILES[meta.id]
  if (profile && (profile as PlatformProfile & { layer?: PublishLayer }).layer) {
    return (profile as PlatformProfile & { layer?: PublishLayer }).layer!
  }
  return (meta.capabilities || []).includes('publish') ? 'direct' : 'draft'
}

/**
 * 按发布层级分成两组，组内按 order → 名称排序
 *
 * 排序规则：order 小的在前；order 相同按名称，保证刷新前后顺序稳定。
 */
export function groupByPublishLayer<T extends { id: string; name: string; capabilities?: string[] }>(
  platforms: T[]
): { direct: T[]; draft: T[] } {
  const sortFn = (a: T, b: T) => {
    const orderDiff = getPlatformProfile(a.id).order! - getPlatformProfile(b.id).order!
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  }

  return {
    direct: platforms.filter(p => p.id !== 'zip-download' && resolvePublishLayer(p) === 'direct').sort(sortFn),
    draft: platforms.filter(p => p.id !== 'zip-download' && resolvePublishLayer(p) === 'draft').sort(sortFn),
  }
}

/** 内容形态分组统计，用于账号页顶部概览 */
export function countByContentKind(platforms: Array<{ id: string }>): Record<ContentKind, number> {
  return platforms.reduce(
    (acc, p) => {
      acc[getPlatformProfile(p.id).kind] += 1
      return acc
    },
    { graphic: 0, news: 0 } as Record<ContentKind, number>
  )
}

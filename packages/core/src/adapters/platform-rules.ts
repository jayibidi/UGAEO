/**
 * 平台发布规则（标题长度、摘要、前置条件）
 *
 * 为什么单独一张表：各平台的限制散在官方文档、后台提示和报错信息里，
 * 而同步流程要在一个地方判断「这篇内容能不能原样发过去」。
 *
 * 两条原则：
 *
 * 1. **`titleMax` 只写有把握的硬限制**。写错的代价比不写大 ——
 *    用户以为改好了，发过去还是被拒。拿不准的平台一律留空（= 不硬截断）。
 * 2. 拿不准长度的平台用 `titleIdeal` + `titleStyle` 交给 AI 收敛。
 *    AI 生成一个 20 字内的标题，比一个猜错的硬上限安全得多。
 *
 * 已知硬限制的来源：小红书标题 20 字、B站专栏标题 40 字（报错原文
 * 「标题不可为空或超过40字」）、公众号标题 64 字 / 摘要 120 字、知乎与掘金等
 * 技术社区标题 100 字。其余平台的限制随版本变化，不写死。
 */

export interface PlatformPublishRule {
  /** 标题硬上限（字符数，按码点计）。超过平台会直接拒 */
  titleMax?: number
  /** 标题硬下限，低于它平台会拒（很少见） */
  titleMin?: number
  /** 交给 AI 改写时的目标长度区间 */
  titleIdeal?: [number, number]
  /** 平台调性，拼进 AI 的 prompt；不是给用户看的 */
  titleStyle?: string
  /** 标题里不允许出现的字符（正则源，如书名号） */
  titleForbidden?: string
  /** 摘要硬上限 */
  summaryMax?: number
  /** 标签最多几个 */
  tagsMax?: number
  /** 正文必须有图（小红书图文、什么值得买等） */
  needImage?: boolean
  /** 该平台没有独立标题栏，标题要并进正文开头 */
  titleInBody?: boolean
  /** 发布前必须自己准备好的东西（无法自动完成，只能提示） */
  preconditions?: string[]
}

/** 技术社区通用调性 */
const TECH_STYLE = '点明技术栈与产出，别用「浅谈」「聊聊」这类套话'

export const PLATFORM_RULES: Record<string, PlatformPublishRule> = {
  // ── 技术 / 长文社区：标题 100 字 ──
  zhihu: { titleMax: 100, titleIdeal: [12, 30], titleStyle: '信息密度高，可用「如何 / 为什么 / 这几点」结构，让人一眼知道能学到什么' },
  juejin: { titleMax: 100, titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  csdn: { titleMax: 100, titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  cnblogs: { titleMax: 100, titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  oschina: { titleMax: 100, titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  segmentfault: { titleMax: 100, titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  '51cto': { titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  imooc: { titleIdeal: [12, 30], titleStyle: TECH_STYLE },
  woshipm: { titleIdeal: [12, 28], titleStyle: '产品 / 运营视角，点出方法论或案例结论' },

  // ── 文档 / 笔记 ──
  yuque: { titleMax: 100, titleIdeal: [10, 30], titleStyle: '偏文档标题，克制、可带版本或范围限定' },
  jianshu: { titleMax: 100, titleIdeal: [10, 30], titleStyle: '偏随笔与经验分享，可略带情绪但不标题党' },

  // ── 短内容 / 强调性平台 ──
  xiaohongshu: {
    titleMax: 20,
    titleIdeal: [8, 20],
    titleStyle: '小红书口吻：像跟朋友说话，带具体场景、数字或结果，不用书名号',
    needImage: true,
  },
  bilibili: { titleMax: 40, titleIdeal: [10, 40], titleStyle: 'B站专栏：短平快、有信息钩子，能带数字就带' },
  weibo: {
    titleMax: 30,
    titleIdeal: [8, 25],
    titleStyle: '像一句话热搜：短、有话题感，不要书名号',
    titleForbidden: '[《》]',
  },
  douban: { titleIdeal: [8, 25], titleStyle: '豆瓣：文艺、克制、不标题党，可以留一点余味' },
  weixin: {
    titleMax: 64,
    summaryMax: 120,
    titleIdeal: [12, 30],
    titleStyle: '公众号：可带悬念或明确结论，避免夸张承诺',
  },

  // ── 资讯 / 媒体号 ──
  toutiao: { titleMax: 30, titleIdeal: [12, 28], titleStyle: '头条号：直给结论，前置数字或冲突点' },
  baijiahao: { titleMax: 40, titleIdeal: [12, 30], titleStyle: '百家号：信息完整、正向表述，别用绝对化词' },
  netease: { titleIdeal: [12, 28], titleStyle: '网易号：资讯口吻，点明事件与结果' },
  sohu: { titleIdeal: [12, 30], titleStyle: '搜狐号：资讯口吻，可带地域或行业限定词' },
  'tencent-om': { titleIdeal: [12, 28], titleStyle: '企鹅号：资讯口吻，克制、正向' },
  huxiu: { titleIdeal: [12, 30], titleStyle: '虎嗅：有观点、敢下判断，但不夸张' },
  jiemian: { titleIdeal: [12, 30], titleStyle: '界面新闻：严肃财经口吻，突出事实与数据' },
  xueqiu: { titleIdeal: [10, 28], titleStyle: '雪球：投资视角，点明标的或结论，不荐股' },
  eastmoney: { titleIdeal: [10, 28], titleStyle: '东方财富：财经资讯口吻，突出数据或政策' },

  // ── 消费 / 投稿 / B2B ──
  smzdm: { titleIdeal: [10, 25], titleStyle: '什么值得买：突出价格、型号、使用场景，务实', needImage: true },
  shunqi: { titleIdeal: [10, 30], titleStyle: 'B2B 企业资讯：突出企业与行业价值' },
  bafang: { titleIdeal: [10, 30], titleStyle: 'B2B 企业资讯：突出产品与供给能力' },
  huangye88: { titleIdeal: [10, 30], titleStyle: 'B2B 企业资讯：突出产品与供给能力' },

  // ── 只开入口页、需要人工提交的平台 ──
  baiduzhidao: { titleIdeal: [8, 25], titleStyle: '问答口吻：直接是一个问题或一句结论', preconditions: ['需要在平台内选择问题或分类后手动提交'] },
  ithome: { titleIdeal: [12, 30], titleStyle: '科技资讯：点明产品与事件', preconditions: ['IT之家投稿需在投稿页手动提交'] },
  infoq: { titleIdeal: [12, 30], titleStyle: '技术资讯：点明技术点与结论', preconditions: ['InfoQ 只接受投稿表单，需手动提交'] },
  kuaidong: { titleIdeal: [10, 30], titleStyle: '百科条目：名词化、客观陈述', preconditions: ['快懂百科需创建词条，不支持文章同步'] },
}

/** 拿某个平台的规则；没登记的平台按「不限制」处理 */
export function getPlatformRule(platformId: string): PlatformPublishRule {
  return PLATFORM_RULES[platformId] || {}
}

/** 平台规则里需要人工准备的前置条件，用于发布前提示 */
export function platformPreconditions(platformId: string): string[] {
  return getPlatformRule(platformId).preconditions || []
}

/**
 * 投稿制平台适配器（新增 · 仅草稿层）
 *
 * 平台：IT之家、InfoQ 中文站、快懂百科
 *
 * 这三家都没有「自助发布后台」：
 * - IT之家：投稿入口只有说明页，官方走邮箱/私信
 * - InfoQ：/contribute 是投稿介绍页，没有输入框，走作者申请流程
 * - 快懂百科：词条编辑流程，提交后等审核，且需要已有词条或创建权限
 *
 * 所以它们的能力里不含 'publish' —— 归入「仅草稿」层；
 * 而且全部标 manualOnly：只打开入口页 + 说明要人工做什么，一次注入都不发。
 * 以前拿通用表单选择器硬填的结果是——往搜索框里打标题，还把结果标成「已同步」。
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

/**
 * 投稿页多为简单表单
 *
 * 注意别写 `input[type="text"]` 这种兜底：投稿页上往往还有站内搜索框，
 * 兜底选择器会把文章标题直接打进搜索框，看起来"填成功了"，实际什么都没提交。
 */
const SUBMIT_TITLES = [
  'input[placeholder*="标题"]',
  'input[name="title"]',
  'input[id*="title"]',
  'textarea[placeholder*="标题"]',
  'textarea[name="title"]',
]

const SUBMIT_EDITORS = [
  'div[contenteditable="true"]',
  'textarea[name="content"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="内容"]',
  'textarea[name="content_text"]',
]

/**
 * IT之家
 *
 * 投稿入口 dyn.ithome.com/tougao 是一张**纯说明页**（没有任何表单输入框，
 * 官方要求把稿件发到投稿邮箱 / 站内私信），www.ithome.com/tougao 已经 404。
 * 以前拿通用表单选择器去填，必然 0 命中，自检里红一片，同步里也只是白开一个页。
 *
 * 所以标 manualOnly：只打开说明页，明确告诉用户要人工投递，不再假装能自动填。
 */
export class IthomeAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'ithome',
    name: 'IT之家',
    icon: 'https://www.ithome.com/favicon.ico',
    homepage: 'https://www.ithome.com',
    capabilities: ['article', 'draft'],
  }

  protected readonly requiresAuth = false

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'dyn.ithome.com/tougao',
    editorUrl: 'https://dyn.ithome.com/tougao',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿'],
  }

  protected readonly sessionCookieNames: string[] = []

  protected manualMessage(): string {
    return 'IT之家的投稿入口只有说明页（没有在线表单，官方要求走投稿邮箱/站内私信）：已打开页面，正文请人工投递。扩展不会往搜索框里乱填东西。'
  }
}

/**
 * InfoQ 中文站
 *
 * /contribute 是「深度文章投稿」介绍页，整页只有文案和跳转按钮，没有任何输入框
 * （实测 HTML 里 0 个 input / textarea）。真正的稿件要走他们的作者申请流程。
 *
 * 同样标 manualOnly：开页 + 说明，不做无意义的注入。
 */
export class InfoqAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'infoq',
    name: 'InfoQ 中文站',
    icon: 'https://www.infoq.cn/favicon.ico',
    homepage: 'https://www.infoq.cn',
    capabilities: ['article', 'draft'],
  }

  protected readonly requiresAuth = false

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'infoq.cn/contribute',
    editorUrl: 'https://www.infoq.cn/contribute',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿'],
  }

  protected readonly sessionCookieNames: string[] = []

  protected manualMessage(): string {
    return 'InfoQ 中文站的投稿页是说明页（没有在线编辑器），稿件需要走作者申请/编辑约稿：已打开页面，正文请人工投递。'
  }
}

/**
 * 快懂百科（原互动百科，现字节旗下）
 *
 * 词条是「编辑提交 → 审核」，没有文章发布入口；
 * 且新词条要过收录门槛，不适合批量灌内容。
 *
 * 这里标成 manualOnly：只打开创建页，不注入内容。
 * 以前它靠 SUBMIT_TITLES 里的 `input[type="text"]` 去填，
 * 结果把文章标题写进了站内搜索框，还把草稿页当成「同步成功」。
 */
export class KuaidongAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'kuaidong',
    name: '快懂百科',
    icon: 'https://www.baike.com/favicon.ico',
    homepage: 'https://www.baike.com',
    capabilities: ['article', 'draft'],
  }

  /** 创建词条必须登录（未登录时 /create 会跳登录页），但这里不做登录过滤：
   *  登录态写在字节 passport 上，Cookie 名不稳定，判错反而会把平台整个藏起来。 */
  protected readonly requiresAuth = false

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'create',
    editorUrl: 'https://www.baike.com/create',
    titleSelectors: ['input[placeholder*="词条"]', 'input[placeholder*="标题"]'],
    editorSelectors: ['div[contenteditable="true"]', 'textarea[placeholder*="内容"]'],
    publishTexts: ['提交', '创建'],
  }

  protected readonly sessionCookieNames: string[] = []

  protected manualMessage(): string {
    return '快懂百科是「编辑词条」流程，没有文章编辑器：已打开创建页，需要先登录，人工选择词条后提交审核。扩展不会替你新建词条，避免灌入无意义内容。'
  }
}

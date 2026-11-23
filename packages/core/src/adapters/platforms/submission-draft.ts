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
 * 投稿入口 dyn.ithome.com/tougao 是一张**纯说明页**：没有在线编辑器，
 * 官方给的两条路是「App 内置投稿」和「在金山文档写好再一键导入」。
 * 因此登录是必须的（要绑账号才能被采用），但扩展既不能代填也不能代发。
 *
 * 以前把这里标成「无需登录」是错的：用户明明登录了，界面却说不用登录，
 * 反而不清楚自己到底能不能发。
 */
export class IthomeAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'ithome',
    name: 'IT之家',
    icon: 'https://www.ithome.com/favicon.ico',
    homepage: 'https://www.ithome.com',
    // 没有可填充的编辑器，自然谈不上「一键发布」：只到草稿（人工投递）这一层
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly requiresAuth = true

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'dyn.ithome.com/tougao',
    editorUrl: 'https://dyn.ithome.com/tougao/',
    loginUrl: 'https://www.ithome.com',
    authHosts: ['ithome.com'],
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿'],
  }

  protected readonly sessionCookieNames: string[] = []

  protected manualMessage(): string {
    return 'IT之家没有网页版发文编辑器：官方路径是「App 内投稿」或在金山文档写好正文后由客户端一键导入（指南 https://img.ithome.com/app/tips/kdocs.html?hidemenu=1）。稿件已整理好，请复制正文人工投递。'
  }
}

/**
 * InfoQ 中文站（写作社区 xie.infoq.cn）
 *
 * `www.infoq.cn/contribute` 只是「深度文章投稿」介绍页，整页没有输入框；
 * 真正能发文章的是写作社区 `xie.infoq.cn`：注册作者后在首页点「写点什么」，
 * 创作台在 `/application`。所以入口直连创作台，不再指向门户的介绍页。
 *
 * 仍需登录（企业号 / 作者账号），以前标成「无需登录」是错的：
 * 未登录时打开只会被弹回登录页，用户以为插件坏了。
 *
 * 编辑器的 DOM 结构未确认，因此保持 manualOnly：打开创作台 + 说明操作路径，
 * 不拿通用选择器盲填（填进搜索框那种「看着成功」比失败更糟）。
 */
export class InfoqAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'infoq',
    name: 'InfoQ 中文站',
    icon: 'https://www.infoq.cn/favicon.ico',
    homepage: 'https://xie.infoq.cn',
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'xie.infoq.cn',
    editorUrl: 'https://xie.infoq.cn/application',
    loginUrl: 'https://xie.infoq.cn',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿', '发布'],
  }

  protected readonly sessionCookieNames = [
    'infoq_token',
    'infoq_user',
    'infoq_session',
    'xie_user',
    'access_token',
    'user_token',
  ]

  protected manualMessage(): string {
    return '已打开 InfoQ 写作社区创作台。点首页右上角「写点什么」新建文章，把正文粘贴进去后发布；扩展不盲填未知结构的编辑器。'
  }
}

/**
 * 快懂百科（原互动百科，现字节旗下）
 *
 * 它**没有文章形态**：既没有草稿箱，也没有「发布文章」的入口，只有
 * 「创建词条 / 编辑已有词条 → 提交审核」。所以正确的能力是 article + draft（人工），
 * 永远不该出现「已发布」。
 *
 * 词条的创建与编辑都要登录：未登录访问 /create 会被 302 到 /login。
 * 以前这里 `requiresAuth = false`，界面显示「无需登录」还报「连接成功」，
 * 用户点进去只会撞登录页 —— 现在改为必须登录，并按实际跳转实测。
 */
export class KuaidongAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'kuaidong',
    name: '快懂百科',
    icon: 'https://www.baike.com/favicon.ico',
    homepage: 'https://www.baike.com',
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly requiresAuth = true

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'baike.com/create',
    editorUrl: 'https://www.baike.com/create',
    loginUrl: 'https://www.baike.com/login',
    authHosts: ['baike.com'],
    // 未登录访问 /create 会被 302 到 /login?redirect_url=...，这是最直接的判据
    authProbe: {
      url: 'https://www.baike.com/create',
      guestUrlHints: ['/login'],
    },
    titleSelectors: ['input[placeholder*="词条"]', 'input[placeholder*="标题"]'],
    editorSelectors: ['div[contenteditable="true"]', 'textarea[placeholder*="内容"]'],
    publishTexts: ['提交', '创建'],
  }

  protected readonly sessionCookieNames: string[] = []

  protected manualMessage(): string {
    return '快懂百科只支持「创建 / 编辑词条」，没有文章草稿箱和文章发布入口：已打开创建页（需登录），请按词条规范提交审核。编辑已有条目请到用户中心 https://www.baike.com/user 的「我的词条」。'
  }
}

/**
 * B2B 企业黄页适配器
 *
 * 平台：八方资源网（b2b168.com）、黄页88（huangye88.com）
 *
 * 这两家的发布后台是十几年前的模板结构（table 布局 + 服务端 Session +
 * 多步表单），和「文章编辑器」完全不是一回事：
 *
 * 1. 黄页88 的发布页是 `fabuxinxi.huangye88.com`，第一步必须先选四级分类
 *    （消费品 › 家电 › 小家电 › 直饮机），选完才出现标题 / 详细说明表单；
 * 2. 八方资源网把「发布供应 / 求购信息」放在会员中心菜单里，
 *    同样是先选分类再填属性（价格、规格、有效期），没有可粘正文的富文本编辑器。
 *
 * v2.8.3 及以前把 `mw.b2b168.com/Index.aspx`（会员中心首页）和
 * `my.huangye88.com`（会员中心首页）当作「编辑器地址」去注入，
 * 结果永远是「等待 12000ms 仍没找到标题输入框」—— 因为那两页根本没有标题框。
 *
 * 现在的口径：**只打开发布页，不注入内容**（manualOnly）。
 * 硬把文章标题打进 B2B 的属性表单，只会产出一条审核不过的垃圾信息；
 * 说清楚「这里要人工选分类」，比假装同步成功诚实。
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

/** 老式后台的通用编辑器候选（含 UEditor / KindEditor 的 iframe 形态） */
const LEGACY_EDITORS = [
  '.cke_wysiwyg_frame',
  'iframe.ke-edit-iframe',
  'iframe[id*="editor"]',
  '.wangEditor-container [contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea[name="content"]',
  'textarea[id*="content"]',
  'textarea',
]

/**
 * 标题候选
 *
 * 注意这里**不能**放 `input[type="text"]`：黄页类后台的登录页/首页都有站内搜索框，
 * 兜底选择器会把文章标题打进搜索框，体检还显示「标题✓」——看着成功，实际什么都没提交。
 * 真找不到宁可在自检里报红，也不要假装填上了。
 */
const LEGACY_TITLES = [
  'input[placeholder*="标题"]',
  'input[name="title"]',
  'input[id*="title"]',
  'textarea[name="title"]',
  'input[name="subject"]',
  'input[name="art_title"]',
]

/**
 * 八方资源网
 *
 * 会员中心在 `mw.b2b168.com`（登录页 `m.b2b168.com/Login.aspx`），
 * 旧代码写的 `member.b2b168.com` 是 404 —— 入口本身就是错的。
 * 登录态在 ASP.NET Session 里，只能实测：访客访问会员中心会被 301
 * 到 `Index.aspx?pg=login`。
 */
export class BafangAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'bafang',
    name: '八方资源网',
    icon: 'https://www.b2b168.com/favicon.ico',
    homepage: 'https://www.b2b168.com',
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'mw.b2b168.com',
    editorUrl: 'https://mw.b2b168.com/Index.aspx',
    loginUrl: 'https://m.b2b168.com/?pg=login',
    authHosts: ['b2b168.com'],
    authProbe: {
      url: 'https://mw.b2b168.com/Index.aspx',
      guestUrlHints: ['pg=login', '/login'],
      authTexts: ['退出', '我的会员', '会员中心'],
    },
    titleSelectors: LEGACY_TITLES,
    editorSelectors: LEGACY_EDITORS,
    publishTexts: ['发布', '提交', '发表', '保存'],
    extraWaitMs: 1000,
  }

  protected readonly sessionCookieNames = ['b2b168user', 'b2b_user', 'b2b168_token']

  protected manualMessage(): string {
    return '已打开八方资源网会员中心。该平台发布的是「供应 / 求购信息」：请在左侧点「发布信息」→ 选分类 → 填标题与详细说明后提交（多步表单，扩展不代填，避免信息进错分类）'
  }
}

/**
 * 黄页88
 *
 * 会员中心 `my.huangye88.com`（访客 302 到 `/login.html`），
 * 真正的发布页是独立子站 `fabuxinxi.huangye88.com`（第一步选分类）。
 */
export class Huangye88Adapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'huangye88',
    name: '黄页88',
    icon: 'https://www.huangye88.com/favicon.ico',
    homepage: 'https://my.huangye88.com',
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'huangye88.com',
    editorUrl: 'https://fabuxinxi.huangye88.com/',
    loginUrl: 'https://my.huangye88.com/login.html',
    authHosts: ['huangye88.com'],
    authProbe: {
      url: 'https://my.huangye88.com/',
      guestUrlHints: ['login.html'],
      authTexts: ['退出', '会员中心', '发布信息'],
    },
    titleSelectors: LEGACY_TITLES,
    editorSelectors: LEGACY_EDITORS,
    publishTexts: ['发布', '提交', '发表', '保存'],
    extraWaitMs: 1000,
  }

  protected readonly sessionCookieNames = ['huangye88_user', 'hy88_user', 'huangye88_token']

  protected manualMessage(): string {
    return '已打开黄页88发布页。该平台要先选四级分类（如 消费品 › 家电 › 小家电），选完才出标题与说明表单，扩展不代填；填完点「发布」等审核（约 2 小时）'
  }
}

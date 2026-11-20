/**
 * B2B 企业黄页适配器（新增）
 *
 * 平台：八方资源网（b2b168.com）、黄页88（huangye88.com）
 *
 * 这两家的发布后台都是十几年前的模板结构（table 布局 + textarea + iframe 编辑器），
 * 没有富文本 API，也不带复杂签名，所以能填但选择器必须写得非常宽松。
 *
 * 内容定位：发的是「企业信息 + 企业资讯」，价值在于让企业主体被搜索引擎收录，
 * 不是媒体分发。因此统一放在「可直发」层的末位。
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
 * 会员中心在 `mw.b2b168.com`（登录页 `m.b2b168.com/?pg=login`），
 * 旧代码写的 `member.b2b168.com` 是 404 —— 入口本身就是错的。
 * 登录态同样在 ASP.NET Session 里，只能实测：访客访问会员中心会被 301
 * 到 `Index.aspx?pg=login`。
 */
export class BafangAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'bafang',
    name: '八方资源网',
    icon: 'https://www.b2b168.com/favicon.ico',
    homepage: 'https://www.b2b168.com',
    capabilities: ['article', 'draft', 'publish'],
  }

  protected readonly pageConfig: PagePublishConfig = {
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
}

/**
 * 黄页88
 *
 * 会员中心 `my.huangye88.com`，访客会被 302 到 `/login.html?from=...`。
 */
export class Huangye88Adapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'huangye88',
    name: '黄页88',
    icon: 'https://www.huangye88.com/favicon.ico',
    homepage: 'https://my.huangye88.com',
    capabilities: ['article', 'draft', 'publish'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'huangye88.com',
    editorUrl: 'https://my.huangye88.com/',
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
}

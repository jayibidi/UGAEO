/**
 * B2B 企业黄页适配器（新增）
 *
 * 平台：顺企网（11467.com）、八方资源网（b2b168.com）、黄页88（huangye88.com）
 *
 * 这三家的发布后台都是十几年前的模板结构（table 布局 + textarea + iframe 编辑器），
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

const LEGACY_TITLES = [
  'input[placeholder*="标题"]',
  'input[name="title"]',
  'input[id*="title"]',
  'textarea[name="title"]',
  'input[type="text"]',
]

/**
 * 顺企网
 * 免费注册企业账号，会员中心可发企业资讯
 */
export class ShunqiAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'shunqi',
    name: '顺企网',
    icon: 'https://www.11467.com/favicon.ico',
    homepage: 'https://www.11467.com',
    capabilities: ['article', 'draft', 'publish'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: '11467.com',
    editorUrl: 'https://www.11467.com/',
    titleSelectors: LEGACY_TITLES,
    editorSelectors: LEGACY_EDITORS,
    publishTexts: ['发布', '提交', '发表', '保存'],
    extraWaitMs: 1000,
  }

  protected readonly sessionCookieNames = ['ASP.NET_SessionId', '11467_user', 'qy_user']
}

/**
 * 八方资源网
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
    editorUrlMatch: 'b2b168.com',
    editorUrl: 'https://member.b2b168.com/',
    titleSelectors: LEGACY_TITLES,
    editorSelectors: LEGACY_EDITORS,
    publishTexts: ['发布', '提交', '发表', '保存'],
    extraWaitMs: 1000,
  }

  protected readonly sessionCookieNames = ['ASP.NET_SessionId', 'b2b168user', 'b2b_user']
}

/**
 * 黄页88
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
    titleSelectors: LEGACY_TITLES,
    editorSelectors: LEGACY_EDITORS,
    publishTexts: ['发布', '提交', '发表', '保存'],
    extraWaitMs: 1000,
  }

  protected readonly sessionCookieNames = ['PHPSESSID', 'huangye88_user', 'hy88_user']
}

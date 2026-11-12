/**
 * 投稿制平台适配器（新增 · 仅草稿层）
 *
 * 平台：IT之家、InfoQ 中文站、快懂百科
 *
 * 这三家都没有「自助发布后台」：
 * - IT之家、InfoQ：只有投稿入口，编辑择优采用，没有发布按钮
 * - 快懂百科：词条编辑流程，提交后等审核，且需要已有词条或创建权限
 *
 * 所以它们的能力里不含 'publish' —— 归入「仅草稿」层。
 * 实际行为是：打开投稿页 → 尝试填入标题正文 → 无论成败都返回
 * 「需要人工提交」，并把页面留在前台，不让用户以为已经发出去了。
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

/** 投稿页多为简单表单 */
const SUBMIT_TITLES = [
  'input[placeholder*="标题"]',
  'input[name="title"]',
  'input[id*="title"]',
  'textarea[placeholder*="标题"]',
  'input[type="text"]',
]

const SUBMIT_EDITORS = [
  'div[contenteditable="true"]',
  'textarea[name="content"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="内容"]',
  'textarea',
]

/**
 * IT之家
 * 投稿制，无自助后台
 */
export class IthomeAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'ithome',
    name: 'IT之家',
    icon: 'https://www.ithome.com/favicon.ico',
    homepage: 'https://www.ithome.com',
    capabilities: ['article', 'draft'],
  }

  /** 投稿页是公开表单，不需要登录态 */
  protected readonly requiresAuth = false

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    editorUrlMatch: 'ithome.com',
    editorUrl: 'https://www.ithome.com/tougao/',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿'],
  }

  protected readonly sessionCookieNames: string[] = []
}

/**
 * InfoQ 中文站
 * 投稿制，编辑审核后发布
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
    editorUrlMatch: 'infoq.cn',
    editorUrl: 'https://www.infoq.cn/contribute',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '投稿'],
  }

  protected readonly sessionCookieNames: string[] = []
}

/**
 * 快懂百科（原互动百科，现字节旗下）
 *
 * 词条是「编辑提交 → 审核」，没有文章发布入口；
 * 且新词条要过收录门槛，不适合批量灌内容。
 */
export class KuaidongAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'kuaidong',
    name: '快懂百科',
    icon: 'https://www.baike.com/favicon.ico',
    homepage: 'https://www.baike.com',
    capabilities: ['article', 'draft'],
  }

  protected readonly requiresAuth = false

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    editorUrlMatch: 'baike.com',
    editorUrl: 'https://www.baike.com/create',
    titleSelectors: SUBMIT_TITLES,
    editorSelectors: SUBMIT_EDITORS,
    publishTexts: ['提交', '创建'],
  }

  protected readonly sessionCookieNames: string[] = []
}

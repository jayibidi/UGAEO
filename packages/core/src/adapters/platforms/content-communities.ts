/**
 * 图文社区适配器（新增）
 *
 * 平台：简书、什么值得买、百度知道
 *
 * 三家的发布形态差别较大：
 * - 简书：标准富文本编辑器，能填能发
 * - 什么值得买：原创投稿编辑器，发布后审核
 * - 百度知道：问答形态，没有统一编辑器，走投稿/提问页降级
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

/**
 * 简书
 * 写作页是独立的 note-editor，发布即时可见
 */
export class JianshuAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'jianshu',
    name: '简书',
    icon: 'https://www.jianshu.com/favicon.ico',
    homepage: 'https://www.jianshu.com/writer',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: '/writer',
    editorUrl: 'https://www.jianshu.com/writer',
    titleSelectors: [
      'input[name="title"]',
      '.title-input',
      'input[placeholder*="标题"]',
      'input[placeholder*="无标题"]',
      'textarea[placeholder*="标题"]',
      '#arthur-editor input',
    ],
    editorSelectors: [
      '.note-editor',
      '#arthur-editor',
      '.ql-editor',
      '.ProseMirror',
      'div[contenteditable="true"]',
    ],
    publishTexts: ['发布', '发布文章', '发表'],
    extraWaitMs: 3000,
  }

  protected readonly sessionCookieNames = ['remember_user_token', '_m7e_session_core', 'read_mode']
}

/**
 * 什么值得买
 * 原创投稿，发布后进入审核
 */
export class SmzdmAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'smzdm',
    name: '什么值得买',
    icon: 'https://www.smzdm.com/favicon.ico',
    homepage: 'https://post.smzdm.com/publish/',
    capabilities: ['article', 'draft', 'publish', 'image_upload', 'cover'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'publish',
    editorUrl: 'https://post.smzdm.com/publish/',
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '.title input',
      '.article-title input',
    ],
    editorSelectors: [
      '.ProseMirror',
      '.ql-editor',
      '.editor-content [contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[name="content"]',
    ],
    publishTexts: ['发布', '提交', '发表'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = ['sess', 'smzdm_user_id', '__ckguid']
}

/**
 * 百度知道
 *
 * 问答形态：没有「文章编辑器」，提问要选分类、回答要绑定问题 ID。
 * 强行自动发布容易灌出垃圾内容，因此只打开提问页并提示手动提交。
 * capabilities 不含 publish → 归入「仅草稿」那一层。
 */
export class BaiduZhidaoAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'baiduzhidao',
    name: '百度知道',
    icon: 'https://zhidao.baidu.com/favicon.ico',
    homepage: 'https://zhidao.baidu.com',
    capabilities: ['article', 'draft'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    editorUrlMatch: 'zhidao.baidu.com',
    editorUrl: 'https://zhidao.baidu.com/',
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    editorSelectors: ['div[contenteditable="true"]', 'textarea[placeholder*="正文"]'],
    publishTexts: ['提交', '发布'],
  }

  protected readonly sessionCookieNames = ['BDUSS', 'STOKEN']
}

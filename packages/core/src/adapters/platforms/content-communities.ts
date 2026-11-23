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
 *
 * 登录态：以前把 `read_mode` 当会话 Cookie —— 那是「阅读模式」的偏好项，
 * 游客也有，于是没登录也会显示已登录，同步时才被 sign_in 拦下来。
 * 现在只认 `remember_user_token` / `_m7e_session_core`，并加一次实测：
 * 访客打开 `/writer` 会被 302 到 `/sign_in`，这比猜 Cookie 名可靠。
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
    loginUrl: 'https://www.jianshu.com/sign_in',
    authProbe: {
      url: 'https://www.jianshu.com/writer',
      guestUrlHints: ['sign_in', '/login'],
      authTexts: ['草稿', '我的主页', '写文章'],
    },
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
    draftTexts: ['存草稿', '保存草稿'],
    extraWaitMs: 3000,
  }

  protected readonly sessionCookieNames = ['remember_user_token', '_m7e_session_core']
}

/**
 * 什么值得买
 * 原创投稿，发布后进入审核
 *
 * 地址说明：`post.smzdm.com/publish/` 是 404，真正的投稿页是
 * `post.smzdm.com/tougao/`（访客会被 302 到 zhiyou.smzdm.com 登录页，
 * 登录后回到投稿表单）。
 */
export class SmzdmAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'smzdm',
    name: '什么值得买',
    icon: 'https://www.smzdm.com/favicon.ico',
    homepage: 'https://post.smzdm.com/tougao/',
    capabilities: ['article', 'draft', 'publish', 'image_upload', 'cover'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'tougao',
    editorUrl: 'https://post.smzdm.com/tougao/',
    loginUrl: 'https://zhiyou.smzdm.com/user/login',
    entryTexts: ['写文章', '原创投稿', '发布文章', '投稿'],
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[data-placeholder*="标题"]',
      '.title input',
      '.article-title input',
      'input[name="title"]',
    ],
    editorSelectors: [
      '.ProseMirror',
      '.ql-editor',
      '.editor-content [contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[name="content"]',
    ],
    publishTexts: ['发布', '提交', '发表'],
    extraWaitMs: 2500,
  }

  protected readonly sessionCookieNames = ['sess', 'smzdm_user_id', '__ckguid']
}

/**
 * 百度知道
 *
 * 问答形态：没有「文章编辑器」，提问要选分类、回答要绑定问题 ID。
 * 强行自动发布容易灌出垃圾内容，因此只打开提问页并提示手动提交。
 * capabilities 不含 publish → 归入「仅草稿」那一层。
 *
 * manualOnly：不注入内容。以前它用 `input[type="text"]` 兜底，
 * 结果把标题打进了百度知道的搜索框。
 */
export class BaiduZhidaoAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'baiduzhidao',
    name: '百度知道',
    icon: 'https://zhidao.baidu.com/favicon.ico',
    homepage: 'https://zhidao.baidu.com',
    capabilities: ['article', 'draft'],
    // 没有统一文章编辑器 → 第三层「词条平台」
    noEditor: true,
  }

  protected readonly pageConfig: PagePublishConfig = {
    mode: 'submission',
    manualOnly: true,
    editorUrlMatch: 'zhidao.baidu.com',
    editorUrl: 'https://zhidao.baidu.com/',
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    editorSelectors: ['div[contenteditable="true"]', 'textarea[placeholder*="正文"]'],
    publishTexts: ['提交', '发布'],
  }

  protected readonly sessionCookieNames = ['BDUSS', 'STOKEN']

  protected manualMessage(): string {
    return '百度知道是问答形态，没有文章编辑器：已打开提问页，需要人工选分类、写完问题后提交。扩展不会自动灌问答内容。'
  }
}

/**
 * 头条号适配器
 *
 * 头条的 Web 接口带 _signature 反爬签名，无法在 Service Worker 里直接调用，
 * 因此走「打开创作者编辑器 → 页面内填内容 → 触发发布」的路线。
 *
 * 头条编辑器是典型的重 SPA + 富文本（ProseMirror）：
 * - 标题是 textarea.article-title（placeholder「请输入文章标题」）
 * - 正文是 .ProseMirror，外面还套了 .syl-editor / #pgc-editor
 * - 打开时可能弹「检测到未发布的草稿」「新手引导」，会挡住点击
 * - 发布是两步：预览并发布 → 弹窗里再点「发布」
 * - 草稿有独立的「存草稿」按钮，不点它内容只存在编辑器里
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

export class ToutiaoAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条号',
    icon: 'https://mp.toutiao.com/favicon.ico',
    homepage: 'https://mp.toutiao.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'publish',
    editorUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',

    /**
     * 打开编辑器时的遮挡层：新手引导、未发布草稿提示。
     * 只点「继续编辑 / 我知道了」，绝不点「放弃」——那会丢掉用户自己的草稿。
     */
    entrySteps: [
      ['继续编辑', '我知道了'],
    ],

    titleSelectors: [
      'textarea.article-title',
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
      '.article-title textarea',
      '.article-title input',
      '.title-content textarea',
      '.publish-title textarea',
      '.publish-title input',
      '#title',
    ],
    editorSelectors: [
      '.ProseMirror',
      '.syl-editor .ProseMirror',
      '#pgc-editor .ProseMirror',
      '.ql-editor',
      '.bytemd-body',
      '.ProseMirror-focused',
      'div[contenteditable="true"]',
    ],

    /** 头条的草稿箱按钮 */
    draftTexts: ['存草稿', '保存草稿'],

    /** 预览并发布 → 弹窗确认 */
    publishTexts: ['预览并发布', '发布', '下一步'],
    confirmTexts: ['发布', '确认发布', '确定'],

    extraWaitMs: 3000,
    waitMs: 20000,
  }

  protected readonly sessionCookieNames = ['sessionid', 'sessionid_ss', 'sid_tt']
}

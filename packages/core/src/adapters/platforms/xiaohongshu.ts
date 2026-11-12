/**
 * 小红书适配器
 *
 * 小红书创作者中心接口带 x-s / x-t 签名（由页面 _webmsxyw 生成），
 * 只能在页面上下文里完成，所以同样走页面驱动的发布路线。
 *
 * 注意：小红书是图文笔记，发布必须有图片；正文里的图片会被自动上传，
 * 一张都传不上去时只填充内容并返回「请手动补充图片」。
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

export class XiaohongshuAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'xiaohongshu',
    name: '小红书',
    icon: 'https://www.xiaohongshu.com/favicon.ico',
    homepage: 'https://creator.xiaohongshu.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload', 'cover'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'publish',
    editorUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    titleSelectors: [
      'input[placeholder*="标题"]',
      '.title-input input',
      '.d-input input',
      'input.d-text',
    ],
    editorSelectors: [
      '.ql-editor',
      '#post-textarea',
      'div[contenteditable="true"]',
      'textarea[placeholder*="正文"]',
    ],
    publishTexts: ['发布笔记', '发布'],
    requireImages: true,
  }

  protected readonly sessionCookieNames = [
    'web_session',
    'access-token-creator.xiaohongshu.com',
    'galaxy_creator_session_id',
  ]
}

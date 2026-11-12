/**
 * 头条号适配器
 *
 * 头条的 Web 接口带 _signature 反爬签名，无法在 Service Worker 里直接调用，
 * 因此走「打开创作者编辑器 → 页面内填内容 → 触发发布」的路线。
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
    titleSelectors: [
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
      '.article-title textarea',
      '.title-content textarea',
      '.publish-title textarea',
    ],
    editorSelectors: [
      '.ProseMirror',
      '.ql-editor',
      '.bytemd-body',
      'div[contenteditable="true"]',
    ],
    publishTexts: ['预览并发布', '发布', '下一步'],
  }

  protected readonly sessionCookieNames = ['sessionid', 'sessionid_ss', 'sid_tt']
}

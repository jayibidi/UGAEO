/**
 * 资讯门户类适配器（新增）
 *
 * 这五家都只有网页创作者后台，没有对外开放的发布 API，
 * 接口层还带风控，因此在页面上下文里填内容 —— 复用 PagePublishAdapter。
 *
 * 平台：网易号、企鹅号、36氪、虎嗅、界面新闻
 *
 * 选择器策略：先写各自后台已知的结构，末尾一律补通用兜底
 * （contenteditable / textarea）。平台改版时兜底项通常还能命中；
 * 若全部落空，发布结果会返回「已填入需手动发布」或「未找到编辑器」，
 * 不会假装发布成功。
 */
import { PagePublishAdapter, type PagePublishConfig } from '../page-publish'
import type { PlatformMeta } from '../../types'

/** 各平台富文本编辑器通用的候选选择器（兜底用） */
const COMMON_EDITORS = [
  '.ProseMirror',
  '.ql-editor',
  '.wangEditor-container [contenteditable="true"]',
  '.w-e-text-container [contenteditable="true"]',
  '.ck-content',
  '.bytemd-body',
  'div[contenteditable="true"]',
  'iframe.editor-iframe body',
]

const COMMON_TITLES = [
  'textarea[placeholder*="标题"]',
  'input[placeholder*="标题"]',
  'textarea[placeholder*="请输入标题"]',
  'input[placeholder*="请输入标题"]',
  '.title-input input',
  '.article-title textarea',
]

/**
 * 网易号
 * 后台：mp.163.com，发文编辑器是 wangEditor
 */
export class NeteaseAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'netease',
    name: '网易号',
    icon: 'https://mp.163.com/favicon.ico',
    homepage: 'https://mp.163.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: '/article/',
    editorUrl: 'https://mp.163.com/article/edit.html',
    titleSelectors: [...COMMON_TITLES, '.title textarea', 'input.title'],
    editorSelectors: [...COMMON_EDITORS, '.article-editor', '#editor'],
    publishTexts: ['发布', '发布文章', '提交发布'],
    extraWaitMs: 1500,
  }

  protected readonly sessionCookieNames = ['NTES_SESS', 'S_INFO', 'NTES_PASSPORT']
}

/**
 * 企鹅号（腾讯新闻 / 腾讯内容开放平台）
 * 后台：om.qq.com
 */
export class TencentOmAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'tencent-om',
    name: '企鹅号',
    icon: 'https://om.qq.com/favicon.ico',
    homepage: 'https://om.qq.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'articleEdit',
    editorUrl: 'https://om.qq.com/article/articleEdit',
    titleSelectors: [...COMMON_TITLES, '.article-title textarea', '.title-box input'],
    editorSelectors: [...COMMON_EDITORS, '.article-content', '.editor-content'],
    publishTexts: ['发布', '发表', '提交'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = ['om_cookie', 'om_uid', 'eas_sid', 'uin', 'skey']
}

/**
 * 36氪 · 氪号
 * 申请入驻制，通过后在创作者后台发布
 */
export class Kr36Adapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'kr36',
    name: '36氪',
    icon: 'https://www.36kr.com/favicon.ico',
    homepage: 'https://www.36kr.com/creator',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: '/creator/',
    editorUrl: 'https://www.36kr.com/creator/article/publish',
    titleSelectors: [...COMMON_TITLES, '.publish-title input', '.article-title input'],
    editorSelectors: [...COMMON_EDITORS, '.publish-editor', '.article-editor'],
    publishTexts: ['发布', '提交审核', '发表'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = ['krt_uid', 't_uid', 't_token', 'identity']
}

/**
 * 虎嗅 · 虎嗅号
 * 申请入驻制，审核较严，发布后编辑择优推荐
 */
export class HuxiuAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'huxiu',
    name: '虎嗅',
    icon: 'https://www.huxiu.com/favicon.ico',
    homepage: 'https://mp.huxiu.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'article',
    editorUrl: 'https://mp.huxiu.com/article/publish',
    titleSelectors: [...COMMON_TITLES, '.article-title input', '.title-wrap input'],
    editorSelectors: [...COMMON_EDITORS, '.article-content', '.editor-wrap'],
    publishTexts: ['发布', '提交', '发表'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = ['huxiu_web_session', 'hxsuid', 'springsid', 'huxiu_session']
}

/**
 * 界面新闻 · 界面号
 * 申请制（财经号需公众号运营满 30 天），后台投稿后仍经编辑审核
 */
export class JiemianAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'jiemian',
    name: '界面新闻',
    icon: 'https://www.jiemian.com/favicon.ico',
    homepage: 'https://jmedia.jiemian.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'publish',
    editorUrl: 'https://jmedia.jiemian.com/article/publish',
    titleSelectors: [...COMMON_TITLES, '.article-title input', '.publish-title input'],
    editorSelectors: [...COMMON_EDITORS, '.editor-content', '.article-content'],
    publishTexts: ['发布', '投稿', '提交'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = ['jmediasession', 'JSESSIONID', 'jiemian_user', 'jmedia_token']
}

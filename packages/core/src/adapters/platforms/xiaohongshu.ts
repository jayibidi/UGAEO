/**
 * 小红书适配器
 *
 * 小红书创作者中心接口带 x-s / x-t 签名（由页面 _webmsxyw 生成），
 * 只能在页面上下文里完成，所以同样走页面驱动的发布路线。
 *
 * 发布页有三种形态，对应左侧三个页签：
 * - 上传视频：需要视频文件，扩展没有视频源，不接
 * - 上传图文：至少一张图片，图文笔记
 * - 写长文：纯文字长文，先「写长文」→「新的创作」才进编辑器
 * - 播客：需要音频文件，不接
 *
 * 当前打通的是「写长文」：点左侧「写长文」→「新的创作」→ 填标题正文 →
 * 草稿模式点「存草稿」，发布模式走「一键排版 → 下一步 → 发布」。
 *
 * 注意：长文不强制要求图片。以前这里写死 requireImages: true，
 * 拿不到图片就直接判「请手动补充图片」，长文永远走不到下一步。
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

    /**
     * 长文入口是两步：先点左侧「写长文」，再点「新的创作」。
     * 只开 publish/publish 页面是"上传视频 / 上传图文"的首页，
     * 那里根本没有标题框 —— 这正是之前一直报「未找到标题输入框」的原因。
     *
     * 页签的实际文案是「写长文」（发布页 JS 里的枚举名），点开后弹窗里
     * 的按钮是「写长文笔记」，两处都留了候选。
     */
    entrySteps: [
      ['写长文', '写长文笔记'],
      ['新的创作', '新建创作', '开始创作', '写长文笔记'],
    ],

    /** 入口点完之后兜底：编辑器里还找不到标题框时，再按这些文案试一次 */
    entryTexts: ['写长文笔记', '新的创作', '开始创作'],

    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[data-placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
      '.title-input input',
      '.title-input textarea',
      'input.d-text',
      '#post-title',
      '.ql-editor[data-placeholder*="标题"]',
    ],
    editorSelectors: [
      '.ql-editor',
      '.ProseMirror',
      '#post-textarea',
      'textarea[placeholder*="正文"]',
      '[data-placeholder*="正文"]',
      '.article-editor [contenteditable="true"]',
      'div[contenteditable="true"]',
    ],

    /** 长文编辑器的保存按钮 */
    draftTexts: ['存草稿', '保存草稿', '保存'],

    /**
     * 长文发布是「一键排版 → 下一步 → 发布页 → 发布笔记」四段式。
     *
     * 以前只写了「一键排版 → 下一步」，但文案在 A/B 里叫法不统一
     * （一键排版 / 自动排版 / 智能排版），点不到就直接卡在编辑器里，
     * 后面「发布笔记」那个按钮永远不会出现 —— 用户看到的就是「已提交但没发出去」。
     */
    prepareSteps: [
      ['一键排版', '自动排版', '智能排版', '排版'],
      ['下一步', '确认并下一步', '下一步预览', '预览'],
      ['发布笔记', '立即发布', '发布'],
    ],

    publishTexts: ['发布笔记', '立即发布', '发布'],
    confirmTexts: ['确认发布', '确定', '发布'],

    /**
     * 长文的话题写在正文末尾（`#话题`），没有独立标签框。
     * AI 生成的标签交给这里追加，比硬找一个不存在的输入框可靠。
     */
    tagsInBody: true,

    /** 长文是纯文字，不强制图片；有图就顺手传 */
    requireImages: false,

    /** 长文编辑器是重 SPA，模板和编辑器要好几秒才挂载 */
    extraWaitMs: 3000,
    waitMs: 20000,
    stepWaitMs: 2500,
  }

  protected readonly sessionCookieNames = [
    'web_session',
    'access-token-creator.xiaohongshu.com',
    'galaxy_creator_session_id',
  ]
}

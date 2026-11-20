/**
 * 资讯门户类适配器（新增）
 *
 * 这四家都只有网页创作者后台，没有对外开放的发布 API，
 * 接口层还带风控，因此在页面上下文里填内容 —— 复用 PagePublishAdapter。
 *
 * 平台：网易号、企鹅号、虎嗅、界面新闻
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
  '.article-content [contenteditable="true"]',
  '.editor-content [contenteditable="true"]',
  'div[contenteditable="true"]',
  'iframe.editor-iframe body',
  'textarea[name="content"]',
]

const COMMON_TITLES = [
  'textarea[placeholder*="标题"]',
  'input[placeholder*="标题"]',
  'textarea[placeholder*="请输入标题"]',
  'input[placeholder*="请输入标题"]',
  '[data-placeholder*="标题"]',
  'textarea.post_title',
  'input.post_title',
  '.title-input input',
  '.title-input textarea',
  'input[name="title"]',
  'textarea[name="title"]',
  '.article-title textarea',
  '.article-title input',
]

/**
 * 后台首页 → 编辑器的入口文案
 *
 * 自媒体后台的深链改得比版本还快，而首页上那个「发布」按钮十几年没动过。
 * 找不到标题框时按这些文案点进去，比死磕一个 404 的地址有用。
 */
const COMMON_ENTRIES = [
  '发布图文',
  '图文发布',
  '发图文',
  '写文章',
  '发布文章',
  '新建文章',
  '发布',
]

/**
 * 网易号
 * 后台：mp.163.com，发文编辑器是 wangEditor
 *
 * 地址说明：v2.8.3 及以前写的 `mp.163.com/article/edit.html` 现在会 302 到
 * `temp.163.com/special/ntes_404/`，注入时直接报
 * 「Frame with ID 0 is showing error page」。网易号是 hash 路由的单页应用，
 * 发文页是 `#/article-publish`（未登录访问会被带回 login.html 并保留这个 url）。
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
    editorUrlMatch: 'mp.163.com',
    editorUrl: 'https://mp.163.com/#/article-publish',
    // 主地址进不去时退到后台首页，再靠 entryTexts 把「发布」点出来
    editorUrls: ['https://mp.163.com/index.html#/article-publish', 'https://mp.163.com/index.html'],
    entryTexts: COMMON_ENTRIES,
    titleSelectors: [...COMMON_TITLES, '.title textarea', 'input.title'],
    editorSelectors: [...COMMON_EDITORS, '.article-editor', '#editor'],
    publishTexts: ['发布', '发布文章', '提交发布'],
    extraWaitMs: 2500,
  }

  protected readonly sessionCookieNames = ['NTES_SESS', 'S_INFO', 'NTES_PASSPORT']
}

/**
 * 企鹅号（腾讯新闻 / 腾讯内容开放平台）
 * 后台：om.qq.com
 *
 * 地址说明：`om.qq.com/article/articleEdit` 已 404；内容管理首页是
 * `om.qq.com/article/index`（未登录 302 到 userAuth），发文页是
 * `om.qq.com/article/articlePublish`。两条都留作候选：一条失效还有一条，
 * 最后再靠首页上的「发布」入口兜底。
 *
 * 登录态是腾讯通行证（`.qq.com` 域），Cookie 名随登录方式变：
 * QQ 登录写 `p_uin` / `p_skey`，微信登录写 `wxuin` / `wxsid`，
 * 老版本才是 `uin` / `skey`。全列上，漏一个就会「已登录却显示未登录」。
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
    editorUrlMatch: 'om.qq.com',
    editorUrl: 'https://om.qq.com/article/articlePublish',
    editorUrls: ['https://om.qq.com/article/index'],
    entryTexts: COMMON_ENTRIES,
    loginUrl: 'https://om.qq.com',
    titleSelectors: [...COMMON_TITLES, '.article-title textarea', '.title-box input'],
    editorSelectors: [...COMMON_EDITORS, '.article-content', '.editor-content'],
    publishTexts: ['发布', '发表', '提交'],
    extraWaitMs: 2500,
  }

  protected readonly sessionCookieNames = [
    'om_cookie',
    'om_uid',
    'om_session',
    'eas_sid',
    'uin',
    'skey',
    'p_uin',
    'p_skey',
    'pt2gguin',
    'ptui_loginuin',
    'luin',
    'lskey',
    'RK',
    'wxuin',
    'wxsid',
  ]
}

/**
 * 虎嗅 · 虎嗅号
 * 后台：mp.huxiu.com（申请入驻制，审核较严，发布后编辑择优推荐）
 *
 * 地址说明：`mp.huxiu.com/article/publish` 等深层地址现在全部 404
 * （nginx 直接给 404），后台是单页应用，只能从根域进。
 * 根域对无头请求会回 403（风控），真实浏览器里正常，所以只能靠
 * 「打开首页 → 点发布入口」这条路，并保留 authProbe 让登录态判定可靠。
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
    editorUrlMatch: 'mp.huxiu.com',
    editorUrl: 'https://mp.huxiu.com/',
    entryTexts: ['发布文章', '写文章', '新建文章', '我要投稿', '投稿', '发布'],
    // 去登录要送到门户（www 有账号登录入口）；mp 只是创作者后台，
    // 未登录时进去只有一片空白，用户找不到登录按钮。
    loginUrl: 'https://www.huxiu.com',
    authHosts: ['huxiu.com'],
    titleSelectors: [...COMMON_TITLES, '.title-wrap input'],
    editorSelectors: [...COMMON_EDITORS, '.editor-wrap'],
    publishTexts: ['发布', '提交', '发表'],
    extraWaitMs: 2500,
  }

  protected readonly sessionCookieNames = [
    'huxiu_web_session',
    'huxiu_session',
    'huxiu_user',
    'hxsuid',
    'hxuid',
    'springsid',
  ]
}

/**
 * 界面新闻 · 界面号
 *
 * 登录在门户 `www.jiemian.com`，投稿后台在 `a.jiemian.com`（作者中心）。
 * 访客访问 `a.jiemian.com/index.php?m=writer&a=submission` 会被 302 到
 * `passport.jiemian.com` —— 看到「被重定向到登录页」就是真的没登录
 * （或在 a.jiemian.com 上没有作者权限），不是页面改版。
 * 申请制（财经号需公众号运营满 30 天），投稿后仍经编辑审核。
 */
export class JiemianAdapter extends PagePublishAdapter {
  readonly meta: PlatformMeta = {
    id: 'jiemian',
    name: '界面新闻',
    icon: 'https://www.jiemian.com/favicon.ico',
    homepage: 'https://www.jiemian.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  protected readonly pageConfig: PagePublishConfig = {
    editorUrlMatch: 'a.jiemian.com',
    editorUrl: 'https://a.jiemian.com/index.php?m=writer&a=submission',
    loginUrl: 'https://www.jiemian.com',
    entryTexts: ['我要投稿', '写文章', '新建稿件', '投稿'],
    titleSelectors: [...COMMON_TITLES, '.publish-title input'],
    editorSelectors: [...COMMON_EDITORS, '.editor-content', '.article-content'],
    publishTexts: ['发布', '投稿', '提交'],
    extraWaitMs: 2000,
  }

  protected readonly sessionCookieNames = [
    'jmediasession',
    'jiemian_user',
    'jmedia_token',
    'jm_user',
    'jmtoken',
    'jm_uid',
  ]
}

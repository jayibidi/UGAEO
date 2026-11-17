/**
 * 飞书文档捕获（纯逻辑，可单测）
 *
 * 场景：用户想借飞书的图文编辑能力排版，再同步到各平台。
 * 流程是「点按钮 → 打开飞书云文档 → 用户打开任意文档 → 自动提取 → 落到待同步文章」，
 * 这里只放不依赖 chrome API 的判定逻辑，后台负责执行。
 */

/** 飞书 / Lark 的域名后缀 */
const FEISHU_SUFFIXES = ['.feishu.cn', '.larksuite.com', '.larkoffice.com']
const FEISHU_EXACT = ['feishu.cn', 'larksuite.com', 'larkoffice.com']

/** 没探测到租户域时的入口（打开后飞书会自己跳到登录 / 租户） */
export const FEISHU_HOME_FALLBACK = 'https://www.feishu.cn/drive/home/'

/**
 * 是不是飞书系的域名
 *
 * 企业自建域（如 `doc.mycorp.com` 反向代理飞书）识别不了，
 * 所以用户在那种环境要先把文档页打开、用「从当前页面提取」。
 */
export function isFeishuHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return FEISHU_EXACT.includes(host) || FEISHU_SUFFIXES.some(suffix => host.endsWith(suffix))
}

/**
 * 能提取的飞书文档地址
 *
 * 只认「文档」类：docx（新版文档）、docs（旧版文档）、doc、wiki（知识库，内页仍是文档）、
 * mindnotes（思维笔记）。
 * 表格 / 多维表格 / 幻灯片不做：结构不匹配图文，硬转会得到一堆错位内容。
 */
const DOC_PATHS = ['docx', 'docs', 'doc', 'wiki', 'mindnotes']

export function isFeishuDocUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (!isFeishuHost(url.hostname)) return false
  const seg = url.pathname.split('/').filter(Boolean)
  if (seg.length < 2) return false
  // 排除云文档首页 / 搜索页 / 登录页
  if (seg[0] === 'drive' || seg[0] === 'search' || seg[0] === 'login' || seg[0] === 'accounts') return false
  return DOC_PATHS.includes(seg[0].toLowerCase())
}

/** 从文档地址里取「租户域」，用来打开该企业的云文档主页 */
export function feishuOriginOf(rawUrl?: string): string | null {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    if (!isFeishuHost(url.hostname)) return null
    // www.feishu.cn 是公共站，不带登录态，别用
    if (url.hostname.toLowerCase() === 'www.feishu.cn') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * 选打开哪个地址进云文档主页
 *
 * 优先复用用户已经登录过的租户域（他当前开着的飞书标签页就是最好的线索），
 * 都没有才退回公共站 —— 那样会先走一次登录，但至少不会打不开。
 */
export function pickFeishuHomeUrl(openTabUrls: (string | undefined)[]): string {
  for (const raw of openTabUrls) {
    const origin = feishuOriginOf(raw)
    if (origin) return `${origin}/drive/home/`
  }
  return FEISHU_HOME_FALLBACK
}

/** 捕获窗口有效期：用户可能要在飞书里翻一会儿才找到文档 */
export const FEISHU_CAPTURE_TTL = 30 * 60 * 1000

/** 捕获状态，存在 storage 里跨页面可见 */
export type FeishuCaptureState =
  | { status: 'idle' }
  | { status: 'waiting'; until: number; homeUrl: string }
  | { status: 'done'; until: number; title: string; images: number }
  | { status: 'failed'; until: number; error: string }

export function isCaptureActive(state: FeishuCaptureState | undefined, now = Date.now()): boolean {
  if (!state || state.status !== 'waiting') return false
  return state.until > now
}

/** 提取结果的一句话描述，用于控制台提示 */
export function describeCaptureResult(title: string, images: number): string {
  const name = title.length > 24 ? `${title.slice(0, 24)}…` : title
  return images > 0
    ? `已从飞书提取《${name}》，含 ${images} 张图片，可直接改或同步`
    : `已从飞书提取《${name}》，文档里没有图片`
}

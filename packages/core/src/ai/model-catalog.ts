/**
 * 模型库分类
 *
 * 中转站 /models 只保证给一个 id 列表，有的会额外带 `supported_endpoint_types`
 * （NewAPI 系网关的字段，形如 ["openai","image-generation"]）。
 * 我们要把「能聊天的」和「能画图的」分成两组，因为设置页里是两套独立选择：
 *   - 文本模型：排版 / 文案 / 识图
 *   - 生图模型：AI 配图
 *
 * 判定顺序：先看网关给的能力声明（可信度最高），再看名称关键词（兜底）。
 * 名称判定要小心两类误伤：
 *   1. 图生图 / 编辑类（flux-kontext、*-inpaint、*-edit、upscale）不是纯文生图，
 *      选了也画不出「一句话出图」的效果，按 other 处理；
 *   2. 向量 / 语音 / 视频 / 审核类模型根本不是画图的，不能因为名字带 image 就归进来。
 */

export type ModelKind = 'chat' | 'image' | 'other'

/** 网关声明里表示「文生图」的写法 */
const IMAGE_ENDPOINT_HINTS = ['image-generation', 'image_generation', 'images', 'image']
/** 声明里表示「图生图 / 编辑」的写法，排除掉 */
const IMAGE_EDIT_ENDPOINT_HINTS = ['image-edit', 'image_edit', 'image-to-image', 'inpaint', 'upscale']

/**
 * 视频 / 数字人类模型
 *
 * 实测中转站会把这类同样声明成 `image-generation`（如 `kling-video-v4`、
 * `pixverse-video`、`viduq3-pro`、`veo_3_1-fast`），按声明分类就会把它们塞进
 * 「生图模型」下拉 —— 选了一调用就是 400。名称里带这些词的一律不算生图。
 */
const VIDEO_NAME_HINTS: RegExp[] = [
  /(^|[\s._-])video([\s._-]|$)/i,
  /(^|[\s._-])veo([\s._-]|$)/i,
  /(^|[\s._-])sora([\s._-]|$)/i,
  /kling/i,
  /\bvidu/i,
  /pixverse/i,
  /runway/i,
  /\bpika\b/i,
  /\bluma\b/i,
  /hailuo/i,
  /seedance/i,
  /\bhunyuan[\s-]?(video|avatar)/i,
  /avatar/i,
  /digital[\s-]?human/i,
]

/** 名称像生图模型的（按覆盖度排序，越具体的越前） */
const IMAGE_NAME_HINTS: RegExp[] = [
  /dall[\s._-]?e/i,
  /gpt-image/i,
  /nano[\s-]?banana/i,
  /seedream/i,
  /seededit/i,
  /qwen[\s-]?image/i,
  /hunyuan[\s-]?image/i,
  /ernie[\s-]?\S*image/i,
  /glm[\s-]?\S*image/i,
  /grok[\s-]?\S*image/i,
  /gemini[\s-]?\S*image/i,
  /stable[\s-]?diffusion/i,
  /\bsdxl\b/i,
  /\bsd3(\.\d)?\b/i,
  /\bflux\b/i,
  /midjourney/i,
  /^mj[\s._-]/i,
  /\bimagen\b/i,
  /ideogram/i,
  /\bkolors\b/i,
  /\bcogview\b/i,
  /\bwanx/i,
  /\bwan2\.\d/i,
  /recraft/i,
  /kandinsky/i,
  /playground[\s-]?v/i,
  /\bt2i\b/i,
  /text[\s-]?to[\s-]?image/i,
]

/** 图生图 / 编辑 / 放大：能出图但不是「描述一句话出图」 */
const IMAGE_EDIT_NAME_HINTS: RegExp[] = [
  /kontext/i,
  /inpaint/i,
  /outpaint/i,
  /upscal/i,
  /variation/i,
  /[\s._-]edit\b/i,
  /^mj[\s._-](blend|describe|shorten|upscale|variation|upload|action)/i,
]

/** 非文本、非生图的模态（向量 / 语音 / 视频 / 审核 / OCR） */
const NON_CHAT_NAME_HINTS: RegExp[] = [
  /embed(ding)?/i,
  /rerank/i,
  /whisper/i,
  /\btts\b/i,
  /speech/i,
  /transcri/i,
  /\baudio\b/i,
  /moderation/i,
  /ocr/i,
  /\bvideo\b/i,
  /\bveo\b/i,
  /\bsora\b/i,
  /kling/i,
  /hailuo/i,
  /minimax[\s._-]?video/i,
  /runway/i,
  /\bpika\b/i,
  /\bluma\b/i,
]

/** 网关声明的能力列表，数组 / 字符串 / 对象都尽量解析出来 */
export function extractEndpointTypes(meta: {
  supported_endpoint_types?: unknown
  endpoint_types?: unknown
  supported_endpoints?: unknown
}): string[] {
  const raw =
    meta.supported_endpoint_types ?? meta.endpoint_types ?? meta.supported_endpoints ?? []
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;|]/) : []

  return list
    .map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const value = record.endpoint ?? record.type ?? record.name ?? record.path
        return typeof value === 'string' ? value : ''
      }
      return ''
    })
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 单个模型归类
 * @param id 模型 id（如 `doubao-seedream-4-0-250828`）
 * @param endpoints 网关声明的能力（可为空）
 */
export function classifyModel(id: string, endpoints: string[] = []): ModelKind {
  const name = (id || '').trim()
  if (!name) return 'other'

  // 视频 / 数字人：网关常与生图共用同一个能力声明，必须在看声明之前排掉
  if (VIDEO_NAME_HINTS.some(re => re.test(name))) return 'other'

  /**
   * 编辑 / 操作类也要抢在声明之前判断
   *
   * 网关会把 `mj_upload`、`flux-kontext` 这类同样声明成 `image-generation`，
   * 先看声明就会被当成文生图放进去。
   */
  const isImageEditName = IMAGE_EDIT_NAME_HINTS.some(re => re.test(name))
  if (isImageEditName) return 'other'

  const declared = endpoints.join(' ')
  const declaredImage = endpoints.some(item =>
    IMAGE_ENDPOINT_HINTS.some(hint => item === hint || item.includes(hint))
  )
  const declaredImageEdit = endpoints.some(item =>
    IMAGE_EDIT_ENDPOINT_HINTS.some(hint => item.includes(hint))
  )

  // 网关明确说了是图生图 / 编辑 → 不当作文生图
  if (declaredImageEdit) return 'other'
  if (declaredImage) return 'image'

  const isImageName = IMAGE_NAME_HINTS.some(re => re.test(name))
  if (isImageName) return 'image'

  // 网关声明能聊天（openai / anthropic / chat 之类）→ 文本模型
  if (declared && /openai|anthropic|chat|completion|responses/.test(declared)) {
    return NON_CHAT_NAME_HINTS.some(re => re.test(name)) ? 'other' : 'chat'
  }

  if (NON_CHAT_NAME_HINTS.some(re => re.test(name))) return 'other'

  // 其余一律当文本模型：中转站上绝大多数条目都是对话 / 多模态模型，
  // 归到 other 会让用户在选择框里找不到刚拉下来的模型
  return 'chat'
}

export interface RawModelMeta {
  id: string
  supported_endpoint_types?: unknown
  endpoint_types?: unknown
  supported_endpoints?: unknown
}

export interface ModelCatalog {
  /** 文本模型（排版 / 文案 / 识图） */
  chat: string[]
  /** 生图模型（AI 配图） */
  image: string[]
  /** 不是文本也不是生图（向量 / 语音 / 视频 / 编辑类） */
  other: string[]
  /** 中转站是否给了能力声明：没给时分类只能靠名字，界面要说明 */
  metaAvailable: boolean
  total: number
}

/**
 * 把 /models 的原始列表分成三组
 */
export function splitModelCatalog(models: RawModelMeta[]): ModelCatalog {
  const chat: string[] = []
  const image: string[] = []
  const other: string[] = []
  let metaAvailable = false

  for (const model of models) {
    if (!model?.id) continue
    const endpoints = extractEndpointTypes(model)
    if (endpoints.length) metaAvailable = true
    const kind = classifyModel(model.id, endpoints)
    if (kind === 'image') image.push(model.id)
    else if (kind === 'chat') chat.push(model.id)
    else other.push(model.id)
  }

  const sort = (list: string[]) => list.sort((a, b) => a.localeCompare(b))
  return {
    chat: sort(chat),
    image: sort(image),
    other: sort(other),
    metaAvailable,
    total: chat.length + image.length + other.length,
  }
}

/** 默认文本模型偏好（越靠前越优先） */
const CHAT_PREFERENCES = [
  /^gpt-4o-mini$/i,
  /^gpt-4o(?!-image)/i,
  /deepseek[-_ ]?chat/i,
  /deepseek/i,
  /claude-.*sonnet/i,
  /qwen.*(plus|max|turbo)/i,
  /glm-4/i,
]

/** 默认生图模型偏好（越靠前越优先） */
const IMAGE_PREFERENCES = [
  /seedream-5/i,
  /seedream-4/i,
  /seedream/i,
  /dall[\s._-]?e-3/i,
  /gpt-image/i,
  /flux/i,
  /qwen-image/i,
  /cogview/i,
  /sd3|sdxl|stable-diffusion/i,
]

/**
 * 从候选里挑一个默认模型
 *
 * 只做「尽量合理」：优先命中偏好表，其次取第一个；列表为空返回空串。
 */
export function pickDefaultModel(list: string[], kind: 'chat' | 'image' = 'chat'): string {
  if (!list.length) return ''
  const preferences = kind === 'image' ? IMAGE_PREFERENCES : CHAT_PREFERENCES
  for (const re of preferences) {
    const hit = list.find(item => re.test(item))
    if (hit) return hit
  }
  return list[0]
}

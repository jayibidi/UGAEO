/**
 * AI 提示词与平台风格配置
 */

/** 各平台内容风格提示，用于「多平台风格适配」 */
export const PLATFORM_STYLE_HINTS: Record<string, string> = {
  zhihu: '知乎：理性克制，先给结论再展开论证，多用小标题分层，可以保留适度专业性，结尾可抛出一个开放式问题引导讨论。不要出现营销话术。',
  juejin: '掘金：技术社区，保留代码块与命令，问题背景→方案→实现→踩坑→总结的结构，术语准确，避免空话与情绪化表达。',
  csdn: 'CSDN：教程化、步骤化，多用「一、二、三」小标题和操作步骤，代码块保留完整，适合新手照做。',
  cnblogs: '博客园：偏工程实践与深度总结，结构清晰，允许较长的背景铺垫与经验复盘。',
  weixin: '微信公众号：口语化、有节奏感，短段落，多用「你」，可用少量 emoji 分隔，重点句独立成段。',
  xiaohongshu: '小红书：口语化、短句、多换行，开头 2 行内抛出钩子，正文分点，结尾提问互动，适度 emoji。',
  weibo: '微博：精简克制，控制在 300 字以内，保留核心信息与结论，去掉冗余铺垫。',
  toutiao: '头条号：通俗易懂，标题钩子强，段落短，信息密度高，少术语多解释。',
  bilibili: 'B站专栏：年轻化、有网感，可用梗但不过度，结构清晰，适合配合视频阅读。',
  baijiahao: '百家号：信息完整、结构规整，客观陈述为主，减少个人情绪表达。',
  sohu: '搜狐号：新闻化表达，开门见山给事实与结论，段落简短。',
  douban: '豆瓣：文艺、个人视角强，允许主观感受与细节描写，避免说教。',
  xueqiu: '雪球：财经视角，数据与逻辑优先，结论要标注前提与风险，不做收益承诺。',
  yuque: '语雀：结构化知识文档，多层级标题、清单、表格，强调可检索性。',
  oschina: '开源中国：技术向，突出开源项目、实现细节与代码片段。',
  segmentfault: 'SegmentFault：问答式技术表达，先描述问题再给解决方案，代码与报错信息完整。',
}

export function platformStyleHint(platformId: string, platformName?: string): string {
  return (
    PLATFORM_STYLE_HINTS[platformId] ||
    `${platformName || platformId}：面向该平台读者，保持信息准确，结构清晰，语气自然，不夸张不营销。`
  )
}

/** 通用系统人设 */
export const SYSTEM_EDITOR =
  '你是一位资深中文内容编辑，擅长把一篇文章改写成符合不同平台调性的版本。你的输出必须忠于原文事实，不虚构数据、不添加原文没有的结论，不使用夸张营销话术。'

export function titlePrompt(title: string, platform: string, count: number): string {
  return `请为下面这篇文章拟 ${count} 个更适合「${platform}」平台的中文标题。

要求：
1. 保留原文核心信息，不虚构、不做标题党；
2. 长度控制在 12-28 个汉字；
3. 风格多样：至少包含 1 个提问式、1 个结论式、1 个数字/清单式；
4. 不要加书名号、不要加 emoji。

原标题：${title}

只输出 JSON，格式：{"titles": ["标题1", "标题2"]}`
}

export function summaryPrompt(text: string, maxLength: number): string {
  return `请为下面这篇文章写一段摘要，用于多平台发布时的简介/导语。

要求：
1. 不超过 ${maxLength} 个汉字；
2. 直接陈述文章讲了什么、给出了什么结论，不要「本文将」「作者认为」这类套话；
3. 不要分点，不要 emoji。

正文：
${text}

只输出 JSON，格式：{"summary": "摘要内容"}`
}

export function tagsPrompt(text: string, platform: string): string {
  return `请为下面这篇文章提取 5-8 个适合「${platform}」平台的标签。

要求：
1. 标签为 2-6 个汉字的名词或名词短语；
2. 覆盖主题、技术/领域、读者关注点；
3. 不要带 # 号，不要重复。

正文：
${text}

只输出 JSON，格式：{"tags": ["标签1", "标签2"]}`
}

export function adaptPrompt(params: {
  title: string
  content: string
  platformId: string
  platformName: string
  sourcePlatform?: string
}): string {
  const { title, content, platformId, platformName, sourcePlatform } = params
  return `请把下面这篇文章改写成适合「${platformName}」平台发布的版本。

平台调性要求：${platformStyleHint(platformId, platformName)}
${sourcePlatform ? `原文来自：${sourcePlatform}，请转换为目标平台读者习惯的表达。` : ''}

硬性约束：
1. 事实、数据、代码、链接必须与原文一致，不得编造；
2. 保留 Markdown 结构（标题层级、代码块、列表、图片语法 ![](url) 原样保留）；
3. 不要输出任何解释性文字，不要用 \`\`\` 包裹整篇文章；
4. 只输出改写后的 Markdown 正文，不要重复文章标题。

标题：${title}

正文：
${content}`
}

/** 正文加工模式 */
export type RewriteMode = 'polish' | 'expand' | 'condense'

/** 各模式的加工说明与推荐温度 */
export const REWRITE_MODES: Record<
  RewriteMode,
  { label: string; temperature: number; instruction: string }
> = {
  polish: {
    label: '润色',
    temperature: 0.55,
    instruction:
      '在不改变原意、不增删事实的前提下打磨表达：去掉口水话与重复，理顺语序，统一术语，让长句更好读。整体长度与原文接近（±10%），段落结构与 Markdown 层级保持不变。',
  },
  expand: {
    label: '扩写',
    temperature: 0.7,
    instruction:
      '在不虚构的前提下把内容讲透：为已有要点补充必要的背景、原因、例子或过渡句，把一笔带过的结论展开成可理解的说明。禁止编造数据、案例、引用与结论。整体长度约为原文的 1.5-2 倍。',
  },
  condense: {
    label: '精简',
    temperature: 0.3,
    instruction:
      '把文章压到原文的 50%-60%：保留核心结论、关键数据、代码与命令，删除重复表述、铺垫与套话。不要删除原文的结构性小标题，不要丢失必要的前提条件。',
  },
}

/**
 * 正文加工提示词（润色 / 扩写 / 精简）
 */
export function rewritePrompt(params: {
  mode: RewriteMode
  content: string
  title?: string
}): string {
  const { mode, content, title } = params
  const spec = REWRITE_MODES[mode]

  return `请对下面这篇文章的正文做「${spec.label}」。

加工要求：${spec.instruction}

硬性约束：
1. 事实、数据、结论必须与原文一致，不得编造、不得引入原文以外的观点；
2. 保留 Markdown 结构（标题层级、代码块、列表、引用、图片语法 ![](url) 原样保留，代码内容一个字都不能改）；
3. 不要输出任何解释性文字，不要用 \`\`\` 包裹整篇文章；
4. 只输出加工后的 Markdown 正文，不要重复文章标题。
${title ? `\n标题（仅用于理解主题，不要输出）：${title}\n` : ''}
正文：
${content}`
}

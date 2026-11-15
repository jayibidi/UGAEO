/**
 * 自检的纯逻辑层
 *
 * 这里只做「拿到事实 → 得出结论」的推理，不碰任何 chrome / DOM API，
 * 所以可以在 Node 里直接单测：给定一份探测原始结果，断言它该判成 pass 还是 fail。
 * 真正的采集（开标签页、注入脚本、读 Cookie）在 diagnostics.ts。
 */

export type DiagnosisLevel = 'ok' | 'warn' | 'error'

/** 单项检查的状态 */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

/** 一条轻量体检结论 */
export interface PlatformDiagnosis {
  id: string
  name: string
  /** 平台自己的图标地址（远程 favicon）；界面优先用打包的本地图标 */
  icon?: string
  homepage: string
  capabilities: string[]
  layer: 'direct' | 'draft'
  kind: string
  driver: 'api' | 'page'
  requiresAuth: boolean
  authMode?: 'cookie' | 'public'
  isAuthenticated: boolean
  username?: string
  entryUrl?: string
  mode?: 'editor' | 'submission'
  /** 纯人工平台：只开入口页，不注入（百科词条 / 问答） */
  manualOnly?: boolean
  /** 适配器声明的登录 Cookie 名 */
  cookieNames: string[]
  /** 当前浏览器里实际命中到的 Cookie 名 */
  foundCookies: string[]
  /** 业务结论：可直发 / 仅草稿 / 需人工 */
  conclusion: string
  issues: string[]
  level: DiagnosisLevel
}

/** 单个选择器的命中明细 */
export interface SelectorHit {
  group: '标题' | '正文'
  selector: string
  /** DOM 里匹配到的节点数 */
  matched: number
  /** 其中可见的节点数（不可见的填不了） */
  visible: number
}

/** 入口步骤执行轨迹 */
export interface EntryStepTrace {
  text: string
  clicked: boolean
  /** 从开始等这个按钮到点下去花了多久 */
  waitedMs: number
  /**
   * 跳过：还没点这一步，编辑器就已经出现了。
   *
   * 典型是头条的「继续编辑」——那是恢复草稿的提示层，编辑器本身已经挂在页面上，
   * 再去等这个按钮只会白等 8 秒，还会被误判成「入口步骤没点全」。
   */
  skipped?: boolean
}

export interface FillTrial {
  attempted: boolean
  /** 标题框能写入并读回 */
  titleOk?: boolean
  /** 正文框能写入并读回 */
  editorOk?: boolean
  error?: string
}

/** 注入脚本在页面里采集到的原始事实 */
export interface PageProbeRaw {
  url: string
  /** 期望的入口地址；和 url 不同域/不同路径说明被重定向过 */
  entryUrl?: string
  /** 入口页地址漂移（被踢到首页 / 登录页 / 别的地方） */
  redirected?: boolean
  pageTitle: string
  bodyLength: number
  /** 是否被踢到登录页 */
  loginWall: boolean
  /** 登录墙的判定依据，报告里要能解释清楚 */
  loginReason?: 'url' | 'password-field' | 'login-text' | 'redirect'
  counts: SelectorHit[]
  steps: EntryStepTrace[]
  /** 标题框命中的具体选择器 */
  titleSelector?: string
  editorSelector?: string
  /** 正文框看起来可写（contenteditable / 未 disabled / 未 readonly） */
  editorWritableLikely: boolean
  publishHit: boolean
  fill: FillTrial
  /** 采集耗时 */
  elapsedMs: number
  /** 探测中途页面整页跳走（context 被销毁前捕获到的目标地址） */
  redirectTo?: string
  /** 注入脚本内部异常（有值说明脚本自己炸了，不是页面问题） */
  error?: string
}

export interface ProbeCheck {
  key: 'login' | 'entry' | 'title' | 'editor' | 'publish' | 'fill' | 'page'
  label: string
  status: CheckStatus
  detail: string
}

export interface PageProbeResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  finalUrl?: string
  pageTitle?: string
  loginWall?: boolean
  titleHit?: boolean
  editorHit?: boolean
  publishHit?: boolean
  counts?: SelectorHit[]
  steps?: EntryStepTrace[]
  fill?: FillTrial
  elapsedMs?: number
  checks: ProbeCheck[]
  issues: string[]
  level: DiagnosisLevel
}

const STATUS_RANK: Record<CheckStatus, number> = { skip: 0, pass: 1, warn: 2, fail: 3 }

/** 由一组检查状态推导整体等级 */
export function levelOfChecks(checks: ProbeCheck[]): DiagnosisLevel {
  let worst: CheckStatus = 'skip'
  for (const check of checks) {
    if (STATUS_RANK[check.status] > STATUS_RANK[worst]) worst = check.status
  }
  if (worst === 'fail') return 'error'
  if (worst === 'warn') return 'warn'
  return 'ok'
}

/** 从命中明细里挑一个「最靠谱」的选择器（优先可见节点多的，再优先排在前面的） */
export function pickBestHit(counts: SelectorHit[], group: '标题' | '正文'): SelectorHit | null {
  const groupCounts = counts.filter(item => item.group === group && item.visible > 0)
  if (groupCounts.length === 0) return null
  return groupCounts.reduce((best, item) => {
    if (item.visible > best.visible) return item
    return best
  })
}

/** 选择器明细压成一行，给报告和详情面板用 */
export function describeCounts(counts: SelectorHit[], group: '标题' | '正文'): string {
  const rows = counts.filter(item => item.group === group)
  if (rows.length === 0) return '没有配置选择器'
  const hits = rows.filter(item => item.visible > 0)
  if (hits.length === 0) {
    const matched = rows.filter(item => item.matched > 0)
    if (matched.length > 0) {
      return `${matched.length} 个选择器只匹配到不可见节点（被隐藏/折叠，填不进去）`
    }
    return `${rows.length} 个选择器全部 0 命中`
  }
  const best = pickBestHit(counts, group)!
  const extra = hits.length > 1 ? `，另有 ${hits.length - 1} 个也命中` : ''
  return `${best.selector}（可见 ${best.visible}）${extra}`
}

export interface ProbeContext {
  requiresAuth: boolean
  mode?: 'editor' | 'submission'
  entrySteps?: string[][]
  /** 等标题框的超时，用于文案 */
  waitMs: number
  /** 期望的入口地址（判断是否被重定向） */
  entryUrl?: string
}

/** 两个地址是不是同一个页面（忽略 query / hash / 末尾斜杠，小红书会加 &from=tab_switch） */
export function samePageUrl(a?: string, b?: string): boolean {
  if (!a || !b) return true
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.host !== ub.host) return false
    const normalize = (path: string) => path.replace(/\/+$/, '') || '/'
    return normalize(ua.pathname) === normalize(ub.pathname)
  } catch {
    return true
  }
}

/**
 * 把原始事实翻译成逐项结论
 *
 * 每一项都回答一个具体问题：登录了吗？入口点进去了吗？标题框在不在？填得进去吗？
 * 这样失败时能直接定位到哪一环，而不是笼统说一句「页面可能改版」。
 *
 * 三条判定原则（都来自真实体检数据的误报）：
 * 1. 编辑器已经就绪时，入口步骤没点到只算「可以跳过」，不算失败
 * 2. 编辑器已经就绪时，正文文字少是正常的（新空白编辑器），不判空壳页
 * 3. 登录墙 / 被重定向到首页时，选择器必然全空 —— 只报一条「先登录」，不再叠加三条假故障
 */
export function buildProbeChecks(
  raw: PageProbeRaw,
  context: ProbeContext
): { checks: ProbeCheck[]; issues: string[] } {
  const checks: ProbeCheck[] = []
  const issues: string[] = []
  const waitSeconds = Math.round(context.waitMs / 1000)

  // ── 0. 注入脚本自己报错 ──
  if (raw.error) {
    checks.push({ key: 'page', label: '页面内容', status: 'fail', detail: `自检脚本异常：${raw.error}` })
    issues.push(
      `✖ 自检脚本在这个页面报错：${raw.error}。这不是选择器问题，把这一行原文贴出来就能定位`
    )
    return { checks, issues }
  }

  const redirectedAway = raw.redirected === true
  const editorReady = Boolean(raw.titleSelector && raw.editorSelector)
  /** 进不去编辑器且看起来是未登录 —— 后续检查一律跳过，避免报一堆假故障 */
  const blockedByLogin = raw.loginWall || (redirectedAway && !editorReady)

  // ── 1. 登录态 ──
  if (raw.loginWall) {
    const reason =
      raw.loginReason === 'password-field'
        ? '页面上出现了可见的密码输入框'
        : raw.loginReason === 'login-text'
          ? '页面出现了「扫码登录 / 登录后查看」这类文案'
          : '地址栏跳到了登录页'
    checks.push({
      key: 'login',
      label: '登录态',
      status: context.requiresAuth ? 'fail' : 'warn',
      detail: `${reason}（${raw.url}）`,
    })
    issues.push(
      context.requiresAuth
        ? '✖ 该平台需要登录：先在浏览器里登录这个站，再回来点「重新体检」；未登录时后面几项都没意义'
        : '入口页出现了登录入口（该平台声称免登录，确认一下是不是被改成必须登录了）'
    )
  } else if (redirectedAway && !editorReady) {
    checks.push({
      key: 'login',
      label: '登录态',
      status: context.requiresAuth ? 'fail' : 'warn',
      detail: `入口页被重定向到 ${raw.url}（不是编辑器页）`,
    })
    issues.push(
      context.requiresAuth
        ? `✖ 入口页被重定向到 ${raw.url}，多半是未登录被踢回首页。先登录，或确认 ${
            context.entryUrl || '入口地址'
          } 还能打开`
        : `入口地址可能变了：打开 ${context.entryUrl || '入口页'} 后落到了 ${raw.url}`
    )
  } else {
    checks.push({
      key: 'login',
      label: '登录态',
      status: 'pass',
      detail: redirectedAway ? `入口页有跳转，但最终进了编辑器（${raw.url}）` : '没有被踢到登录页',
    })
  }

  // ── 2. 入口步骤（小红书：写长文 → 新的创作） ──
  const configuredSteps = (context.entrySteps || []).map(step => step[0])
  if (configuredSteps.length === 0) {
    checks.push({ key: 'entry', label: '入口步骤', status: 'skip', detail: '该平台直接进编辑器，无需点击' })
  } else {
    const traces = configuredSteps.map(text => {
      const found = raw.steps.find(step => step.text === text)
      // 探测提前结束时，没跑到的步骤按「跳过」算，不当成失败
      return found || { text, clicked: false, waitedMs: 0, skipped: true }
    })
    const trace = traces
      .map(step => `${step.text}${step.clicked ? '✓' : step.skipped ? '－' : '✗'}${
        step.clicked ? `(${step.waitedMs}ms)` : ''
      }`)
      .join(' → ')
    const skippedCount = traces.filter(step => step.skipped).length
    const missed = traces.filter(step => !step.clicked && !step.skipped)

    if (missed.length === 0) {
      checks.push({
        key: 'entry',
        label: '入口步骤',
        status: 'pass',
        detail: skippedCount > 0 ? `${trace}（编辑器已就绪，跳过 ${skippedCount} 步）` : trace,
      })
    } else if (editorReady) {
      // 头条的「继续编辑」：编辑器本来就在，这个按钮只是恢复草稿的提示层
      checks.push({
        key: 'entry',
        label: '入口步骤',
        status: 'warn',
        detail: `${trace}；没点到：${missed.map(step => step.text).join('、')}（编辑器已就绪，这一步可以跳过）`,
      })
    } else {
      checks.push({
        key: 'entry',
        label: '入口步骤',
        status: 'fail',
        detail: `${trace}；没点到：${missed.map(step => step.text).join('、')}`,
      })
      issues.push(
        `✖ 入口步骤没点全（${missed.map(step => step.text).join('、')}）：按钮文案变了或被登录墙挡住，进不了编辑器就必然填不上`
      )
    }
  }

  // ── 3. 标题框 ──
  if (raw.titleSelector) {
    const best = raw.counts.find(item => item.selector === raw.titleSelector)
    checks.push({
      key: 'title',
      label: '标题框',
      status: 'pass',
      detail: `${raw.titleSelector}（可见 ${best?.visible ?? 1}）`,
    })
  } else if (blockedByLogin) {
    checks.push({ key: 'title', label: '标题框', status: 'skip', detail: '先进编辑器才能查，登录后再体检' })
  } else {
    const detail = describeCounts(raw.counts, '标题')
    checks.push({ key: 'title', label: '标题框', status: 'fail', detail })
    issues.push(`✖ 标题框 ${waitSeconds} 秒内没找到：${detail}。说明选择器已过期，需要改 pageConfig.titleSelectors`)
  }

  // ── 4. 正文框 ──
  if (raw.editorSelector) {
    const best = raw.counts.find(item => item.selector === raw.editorSelector)
    checks.push({
      key: 'editor',
      label: '正文框',
      status: 'pass',
      detail: `${raw.editorSelector}（可见 ${best?.visible ?? 1}）${
        raw.editorWritableLikely ? '，可写' : '，但可能只读'
      }`,
    })
    if (!raw.editorWritableLikely) {
      issues.push('正文框命中了但看起来是只读的（disabled / readonly），检查是不是打开了预览态')
    }
  } else if (blockedByLogin) {
    checks.push({ key: 'editor', label: '正文框', status: 'skip', detail: '先进编辑器才能查，登录后再体检' })
  } else {
    const detail = describeCounts(raw.counts, '正文')
    checks.push({ key: 'editor', label: '正文框', status: 'fail', detail })
    issues.push(`✖ 正文框 ${waitSeconds} 秒内没找到：${detail}。说明选择器已过期，需要改 pageConfig.editorSelectors`)
  }

  // ── 5. 发布按钮 ──
  if (context.mode === 'submission') {
    checks.push({ key: 'publish', label: '发布按钮', status: 'skip', detail: '投稿页没有发布按钮，人工提交' })
  } else if (blockedByLogin) {
    checks.push({ key: 'publish', label: '发布按钮', status: 'skip', detail: '登录后再查' })
  } else if (raw.publishHit) {
    checks.push({ key: 'publish', label: '发布按钮', status: 'pass', detail: '找到发布入口，可尝试直发' })
  } else {
    checks.push({
      key: 'publish',
      label: '发布按钮',
      status: 'warn',
      detail: '没找到发布入口，同步会降级为「填好内容等手动发」',
    })
    issues.push('没找到发布按钮：同步仍会写入草稿，但不会自动点发布')
  }

  // ── 6. 试填写入（可选） ──
  if (raw.fill.attempted) {
    const titleOk = raw.fill.titleOk === true
    const editorOk = raw.fill.editorOk === true
    const detail = `${titleOk ? '标题✓' : '标题✗'} / ${editorOk ? '正文✓' : '正文✗'}${
      raw.fill.error ? `（${raw.fill.error}）` : ''
    }`
    if (titleOk && editorOk) {
      checks.push({ key: 'fill', label: '试填写入', status: 'pass', detail })
    } else {
      checks.push({ key: 'fill', label: '试填写入', status: 'fail', detail })
      issues.push(
        '✖ 试填没写进去：选择器命中了但页面不认这次输入（多为 React/Vue 受控组件，需要原生 setter + input 事件）'
      )
    }
  } else {
    checks.push({
      key: 'fill',
      label: '试填写入',
      status: 'skip',
      detail: blockedByLogin
        ? '登录后再试'
        : '未开启（开启后会在编辑器里写测试文字验证真的能输入，不保存）',
    })
  }

  // ── 7. 页面本身 ──
  if (editorReady) {
    // 空白编辑器本来就没几个字，拿全页文字量判空壳只会误报（小红书长文就只有 44 字）
    checks.push({
      key: 'page',
      label: '页面内容',
      status: 'skip',
      detail: `编辑器已就绪，正文框是空的属于正常（全页 ${raw.bodyLength} 字）`,
    })
  } else if (blockedByLogin) {
    checks.push({ key: 'page', label: '页面内容', status: 'skip', detail: '未登录，页面内容不做判断' })
  } else if (raw.bodyLength < 200) {
    checks.push({ key: 'page', label: '页面内容', status: 'fail', detail: `全页文字仅 ${raw.bodyLength} 字` })
    issues.push('✖ 页面内容过少，可能是 404 / 空壳页 / 需要登录的中间页')
  } else {
    checks.push({ key: 'page', label: '页面内容', status: 'pass', detail: `${raw.bodyLength} 字，页面正常渲染` })
  }

  return { checks, issues }
}

const LEVEL_RANK: Record<DiagnosisLevel, number> = { ok: 0, warn: 1, error: 2 }

/**
 * 合并「轻量体检」与「页面体检」的结论
 *
 * 界面的统计和筛选必须走同一套口径，否则会出现
 * 「头条号写着页面体检未通过，顶部却统计为 0 个有问题」这种自相矛盾。
 */
export function combineLevel(base: DiagnosisLevel, probe?: PageProbeResult | null): DiagnosisLevel {
  if (!probe || probe.skipped) return base
  return LEVEL_RANK[probe.level] > LEVEL_RANK[base] ? probe.level : base
}

/** 业务结论：把能力声明翻译成人话 */
export function conclusionOf(input: {
  manualOnly?: boolean
  layer: 'direct' | 'draft'
  isAuthenticated: boolean
  requiresAuth: boolean
  authMode?: 'cookie' | 'public'
}): string {
  if (input.manualOnly) return '需人工'
  if (input.authMode === 'public') return input.layer === 'direct' ? '可直发（免登录）' : '仅草稿（免登录）'
  if (input.requiresAuth && !input.isAuthenticated) return '未登录'
  return input.layer === 'direct' ? '可直发' : '仅草稿'
}

const LEVEL_LABEL: Record<DiagnosisLevel, string> = { ok: '正常', warn: '待确认', error: '有问题' }
const STATUS_MARK: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✖', skip: '－' }

/** 生成可复制的纯文本报告（贴进 issue 就能直接定位问题） */
export function reportLines(
  rows: PlatformDiagnosis[],
  probes: Record<string, PageProbeResult>
): string[] {
  const counts = { ok: 0, warn: 0, error: 0 }
  for (const row of rows) counts[combineLevel(row.level, probes[row.id])]++
  const lines: string[] = [
    `UG·AEO 平台自检报告  ${new Date().toLocaleString()}`,
    `共 ${rows.length} 个平台：正常 ${counts.ok} / 待确认 ${counts.warn} / 有问题 ${counts.error}`,
    '',
  ]

  for (const row of rows) {
    const probe = probes[row.id]
    lines.push(
      `【${row.name}】${row.id}  结论：${row.conclusion}  驱动：${row.driver === 'page' ? '页面' : '接口'}  ${
        LEVEL_LABEL[combineLevel(row.level, probe)]
      }`
    )
    lines.push(
      `  登录态：${
        row.authMode === 'public' ? '无需登录' : row.isAuthenticated ? `已登录${row.username ? `(${row.username})` : ''}` : '未登录'
      }${row.cookieNames.length ? `  Cookie：${row.cookieNames.join('/') || '未配置'}${
        row.foundCookies.length ? `（命中 ${row.foundCookies.join('/')}）` : '（一个都没命中）'
      }` : ''}`
    )
    for (const issue of row.issues) lines.push(`  - ${issue}`)
    if (probe) {
      if (probe.skipped) {
        lines.push(`  页面探测：跳过 - ${probe.reason}`)
      } else {
        lines.push(`  页面探测：${LEVEL_LABEL[probe.level]}（${((probe.elapsedMs ?? 0) / 1000).toFixed(1)}s）${probe.finalUrl || ''}`)
        for (const check of probe.checks) {
          lines.push(`    ${STATUS_MARK[check.status]} ${check.label}：${check.detail}`)
        }
      }
    }
    lines.push('')
  }
  return lines
}

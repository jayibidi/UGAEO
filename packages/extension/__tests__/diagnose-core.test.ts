import { describe, expect, it } from 'vitest'
import {
  buildProbeChecks,
  combineLevel,
  conclusionOf,
  describeCounts,
  levelOfChecks,
  pickBestHit,
  reportLines,
  type PageProbeRaw,
  type PlatformDiagnosis,
} from '../src/lib/diagnose-core'

function raw(overrides: Partial<PageProbeRaw> = {}): PageProbeRaw {
  return {
    url: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    pageTitle: '头条号 - 发布文章',
    bodyLength: 3200,
    loginWall: false,
    counts: [
      { group: '标题', selector: 'textarea.article-title', matched: 1, visible: 1 },
      { group: '标题', selector: 'input[placeholder*="标题"]', matched: 0, visible: 0 },
      { group: '正文', selector: '.ProseMirror', matched: 1, visible: 1 },
    ],
    steps: [],
    titleSelector: 'textarea.article-title',
    editorSelector: '.ProseMirror',
    editorWritableLikely: true,
    publishHit: true,
    fill: { attempted: false },
    elapsedMs: 4200,
    ...overrides,
  }
}

const ctx = { requiresAuth: true, mode: 'editor' as const, waitMs: 20000 }

describe('buildProbeChecks', () => {
  it('标题/正文/发布都命中时判正常', () => {
    const { checks, issues } = buildProbeChecks(raw(), ctx)
    expect(issues).toEqual([])
    expect(levelOfChecks(checks)).toBe('ok')
    expect(checks.find(c => c.key === 'title')?.status).toBe('pass')
    expect(checks.find(c => c.key === 'title')?.detail).toContain('textarea.article-title')
    expect(checks.find(c => c.key === 'editor')?.status).toBe('pass')
    expect(checks.find(c => c.key === 'login')?.status).toBe('pass')
  })

  it('被踢到登录页时报登录失败，且不重复报「选择器已过期」', () => {
    const { checks, issues } = buildProbeChecks(
      raw({ loginWall: true, titleSelector: undefined, editorSelector: undefined, publishHit: false, bodyLength: 340 }),
      ctx
    )
    expect(checks.find(c => c.key === 'login')?.status).toBe('fail')
    expect(levelOfChecks(checks)).toBe('error')
    expect(issues.some(i => i.includes('先在该站登录') || i.includes('需要登录'))).toBe(true)
    // 登录墙场景下选择器必然全空，不能顺手把「选择器过期」也算成一笔账
    expect(issues.some(i => i.includes('选择器已过期'))).toBe(false)
  })

  it('入口步骤点不全时直接指出卡在哪一步', () => {
    const { checks, issues } = buildProbeChecks(
      raw({
        steps: [
          { text: '写长文', clicked: true, waitedMs: 900 },
          { text: '新的创作', clicked: false, waitedMs: 8000 },
        ],
        titleSelector: undefined,
        editorSelector: undefined,
      }),
      { ...ctx, entrySteps: [['写长文'], ['新的创作']] }
    )
    const entry = checks.find(c => c.key === 'entry')!
    expect(entry.status).toBe('fail')
    expect(entry.detail).toContain('新的创作✗')
    expect(issues.some(i => i.includes('入口步骤没点全'))).toBe(true)
  })

  it('标题选择器全部 0 命中时给出改配置的明确建议', () => {
    const { checks, issues } = buildProbeChecks(
      raw({
        titleSelector: undefined,
        counts: [
          { group: '标题', selector: 'textarea.article-title', matched: 0, visible: 0 },
          { group: '标题', selector: 'input[name="title"]', matched: 0, visible: 0 },
        ],
      }),
      ctx
    )
    const title = checks.find(c => c.key === 'title')!
    expect(title.status).toBe('fail')
    expect(title.detail).toContain('2 个选择器全部 0 命中')
    expect(issues.some(i => i.includes('pageConfig.titleSelectors'))).toBe(true)
  })

  it('选择器命中的是被隐藏节点时，说明填不进去而不是没找到', () => {
    const { checks } = buildProbeChecks(
      raw({
        titleSelector: undefined,
        counts: [{ group: '标题', selector: 'input[name="title"]', matched: 2, visible: 0 }],
      }),
      ctx
    )
    expect(checks.find(c => c.key === 'title')?.detail).toContain('不可见')
  })

  it('没找到发布按钮只降级为待确认，不算失败', () => {
    const { checks, issues } = buildProbeChecks(raw({ publishHit: false }), ctx)
    expect(checks.find(c => c.key === 'publish')?.status).toBe('warn')
    expect(levelOfChecks(checks)).toBe('warn')
    expect(issues.some(i => i.includes('不会自动点发布'))).toBe(true)
  })

  it('投稿型平台不需要发布按钮，标为跳过', () => {
    const { checks } = buildProbeChecks(raw({ publishHit: false }), { ...ctx, mode: 'submission' })
    expect(checks.find(c => c.key === 'publish')?.status).toBe('skip')
  })

  it('试填失败时会指出受控组件问题', () => {
    const { checks, issues } = buildProbeChecks(
      raw({ fill: { attempted: true, titleOk: true, editorOk: false } }),
      ctx
    )
    expect(checks.find(c => c.key === 'fill')?.status).toBe('fail')
    expect(issues.some(i => i.includes('受控组件'))).toBe(true)
  })

  it('试填成功时判通过', () => {
    const { checks } = buildProbeChecks(raw({ fill: { attempted: true, titleOk: true, editorOk: true } }), ctx)
    expect(checks.find(c => c.key === 'fill')?.status).toBe('pass')
    expect(levelOfChecks(checks)).toBe('ok')
  })

  it('编辑器没命中的空壳页要报出来', () => {
    const { checks, issues } = buildProbeChecks(
      raw({ bodyLength: 30, titleSelector: undefined, editorSelector: undefined, publishHit: false }),
      ctx
    )
    expect(checks.find(c => c.key === 'page')?.status).toBe('fail')
    expect(issues.some(i => i.includes('空壳页'))).toBe(true)
  })

  it('编辑器已就绪时正文很少不算空壳（小红书长文只有 44 字）', () => {
    const { checks, issues } = buildProbeChecks(raw({ bodyLength: 44 }), ctx)
    expect(checks.find(c => c.key === 'page')?.status).toBe('skip')
    expect(issues.some(i => i.includes('空壳页'))).toBe(false)
  })

  it('入口步骤没点到但编辑器已就绪，只算提示不算失败（头条「继续编辑」）', () => {
    const { checks, issues } = buildProbeChecks(
      raw({ steps: [{ text: '继续编辑', clicked: false, waitedMs: 8458 }] }),
      { ...ctx, entrySteps: [['继续编辑']] }
    )
    const entry = checks.find(c => c.key === 'entry')!
    expect(entry.status).toBe('warn')
    expect(entry.detail).toContain('可以跳过')
    expect(issues.some(i => i.includes('入口步骤没点全'))).toBe(false)
    // 其余检查全部通过，所以整体不该是 error
    expect(levelOfChecks(checks)).not.toBe('error')
  })

  it('编辑器已就绪时后置的入口步骤记为跳过，不算漏点', () => {
    const { checks } = buildProbeChecks(
      raw({
        steps: [
          { text: '写长文', clicked: true, waitedMs: 6580 },
          { text: '新的创作', clicked: false, waitedMs: 0, skipped: true },
        ],
      }),
      { ...ctx, entrySteps: [['写长文'], ['新的创作']] }
    )
    const entry = checks.find(c => c.key === 'entry')!
    expect(entry.status).toBe('pass')
    expect(entry.detail).toContain('跳过 1 步')
  })

  it('被重定向到首页时只报一条「先登录」，不再叠加选择器过期', () => {
    const { checks, issues } = buildProbeChecks(
      raw({
        url: 'https://www.163.com/',
        redirected: true,
        titleSelector: undefined,
        editorSelector: undefined,
        publishHit: false,
        bodyLength: 8810,
      }),
      { ...ctx, entryUrl: 'https://mp.163.com/#/article-publish' }
    )
    expect(checks.find(c => c.key === 'login')?.status).toBe('fail')
    expect(checks.find(c => c.key === 'title')?.status).toBe('skip')
    expect(checks.find(c => c.key === 'editor')?.status).toBe('skip')
    expect(checks.find(c => c.key === 'publish')?.status).toBe('skip')
    expect(issues.some(i => i.includes('选择器已过期'))).toBe(false)
    expect(issues.some(i => i.includes('被重定向'))).toBe(true)
  })

  it('注入脚本自己报错时只给一条明确结论', () => {
    const { checks, issues } = buildProbeChecks(raw({ error: 'Cannot read properties of null' }), ctx)
    expect(checks).toHaveLength(1)
    expect(checks[0].status).toBe('fail')
    expect(issues[0]).toContain('自检脚本')
  })
})

describe('combineLevel', () => {
  it('页面体检更差时以页面体检为准', () => {
    expect(combineLevel('ok', { ok: true, level: 'error', checks: [], issues: [] })).toBe('error')
    expect(combineLevel('warn', { ok: true, level: 'ok', checks: [], issues: [] })).toBe('warn')
    expect(combineLevel('ok', undefined)).toBe('ok')
  })

  it('跳过的探测不影响统计', () => {
    expect(
      combineLevel('ok', { ok: true, skipped: true, reason: '未登录', level: 'error', checks: [], issues: [] })
    ).toBe('ok')
  })
})

describe('pickBestHit / describeCounts', () => {
  const counts = [
    { group: '正文' as const, selector: 'a', matched: 1, visible: 0 },
    { group: '正文' as const, selector: 'b', matched: 2, visible: 2 },
    { group: '正文' as const, selector: 'c', matched: 1, visible: 1 },
  ]

  it('挑可见节点最多的那个', () => {
    expect(pickBestHit(counts, '正文')?.selector).toBe('b')
  })

  it('没有可见命中时返回 null', () => {
    expect(pickBestHit([counts[0]], '正文')).toBeNull()
  })

  it('明细文案带命中数与备选数量', () => {
    expect(describeCounts(counts, '正文')).toContain('b（可见 2）')
    expect(describeCounts(counts, '正文')).toContain('另有 1 个也命中')
  })

  it('没有配置选择器时给出明确说明', () => {
    expect(describeCounts([], '标题')).toBe('没有配置选择器')
  })
})

describe('conclusionOf', () => {
  it('可直发 / 仅草稿 / 需人工 / 未登录', () => {
    expect(conclusionOf({ layer: 'direct', isAuthenticated: true, requiresAuth: true })).toBe('可直发')
    expect(conclusionOf({ layer: 'draft', isAuthenticated: true, requiresAuth: true })).toBe('仅草稿')
    expect(conclusionOf({ layer: 'draft', isAuthenticated: false, requiresAuth: true, manualOnly: true })).toBe('需人工')
    expect(conclusionOf({ layer: 'direct', isAuthenticated: false, requiresAuth: true })).toBe('未登录')
    expect(conclusionOf({ layer: 'draft', isAuthenticated: false, requiresAuth: false, authMode: 'public' })).toBe(
      '仅草稿（免登录）'
    )
  })
})

describe('reportLines', () => {
  const row: PlatformDiagnosis = {
    id: 'toutiao',
    name: '头条号',
    homepage: 'https://mp.toutiao.com',
    capabilities: ['article', 'draft', 'publish'],
    layer: 'direct',
    kind: 'news',
    driver: 'page',
    requiresAuth: true,
    authMode: 'cookie',
    isAuthenticated: true,
    entryUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    mode: 'editor',
    cookieNames: ['sessionid'],
    foundCookies: ['sessionid'],
    conclusion: '可直发',
    issues: [],
    level: 'ok',
  }

  it('报告里能直接看到结论与逐项检查', () => {
    const probe = {
      ok: true,
      finalUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      elapsedMs: 4200,
      checks: buildProbeChecks(raw(), ctx).checks,
      issues: [],
      level: 'ok' as const,
    }
    const text = reportLines([row], { toutiao: probe }).join('\n')
    expect(text).toContain('【头条号】toutiao  结论：可直发')
    expect(text).toContain('已登录')
    expect(text).toContain('标题框：textarea.article-title')
    expect(text).toContain('正文框：.ProseMirror')
    expect(text).toContain('页面探测：正常')
  })

  it('跳过的平台写明原因', () => {
    const text = reportLines([row], {
      toutiao: { ok: true, skipped: true, reason: '纯人工平台', checks: [], issues: [], level: 'ok' },
    }).join('\n')
    expect(text).toContain('跳过 - 纯人工平台')
  })
})

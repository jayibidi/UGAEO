import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  PlayCircle,
  RefreshCw,
  ScanSearch,
  Square,
  XCircle,
} from 'lucide-react'
import type { CheckStatus, PlatformDiagnosis, PageProbeResult } from '../../lib/diagnostics'
import { combineLevel, reportLines } from '../../lib/diagnose-core'
import { PlatformIcon } from '../components/PlatformBadge'

type Filter = 'all' | 'issue' | 'ok' | 'page'

const LEVEL_ICON = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
}

const LEVEL_CLASS = {
  ok: 'text-green-600 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

const STATUS_ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skip: ChevronRight,
}

const STATUS_CLASS: Record<CheckStatus, string> = {
  pass: 'text-green-600 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  fail: 'text-red-600 dark:text-red-400',
  skip: 'text-muted-foreground',
}

/** 结论用色：可直发绿、AI 自动发布紫、词条平台 / 未登录灰 */
function conclusionClass(conclusion: string): string {
  if (conclusion.startsWith('可直发')) return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
  if (conclusion.startsWith('AI 自动发布'))
    return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
  return 'bg-muted text-muted-foreground'
}

export function DiagnosticsPage() {
  const [rows, setRows] = useState<PlatformDiagnosis[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [probes, setProbes] = useState<Record<string, PageProbeResult>>({})
  const [probingId, setProbingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dryFill, setDryFill] = useState(false)
  const [batch, setBatch] = useState<{ index: number; total: number; name: string } | null>(null)
  const stopRef = useRef(false)

  const runLight = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_PLATFORMS' })
      if (response?.error) throw new Error(response.error)
      const list = (response?.platforms || []) as PlatformDiagnosis[]
      setRows(list)
      if (list.length === 0) {
        setError(
          '体检没有返回任何平台：适配器没注册成功，或后台 service worker 抛错了。先看扩展的「服务工作线程」控制台。'
        )
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runLight()
  }, [])

  const runProbe = async (platformId: string, force = false) => {
    setProbingId(platformId)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAGNOSE_PAGE',
        payload: { platformId, dryFill, force },
      })
      if (response?.error) throw new Error(response.error)
      setProbes(prev => ({ ...prev, [platformId]: response?.result as PageProbeResult }))
      setExpanded(prev => (prev.includes(platformId) ? prev : [...prev, platformId]))
    } catch (e) {
      setProbes(prev => ({
        ...prev,
        [platformId]: {
          ok: false,
          checks: [],
          issues: [`✖ 探测失败：${(e as Error).message}`],
          level: 'error',
        },
      }))
    } finally {
      setProbingId(null)
    }
  }

  const probeTargets = useMemo(() => rows.filter(row => row.driver === 'page' && !row.manualOnly), [rows])

  const runAll = async () => {
    if (probeTargets.length === 0) return
    stopRef.current = false
    for (let i = 0; i < probeTargets.length; i++) {
      if (stopRef.current) break
      setBatch({ index: i + 1, total: probeTargets.length, name: probeTargets[i].name })
      await runProbe(probeTargets[i].id)
    }
    setBatch(null)
  }

  // 统计与筛选必须和行内展示用同一套口径：
  // 只看轻量体检会出现「整列写着页面体检未通过，顶部却统计 0 个有问题」
  const levelOf = (row: PlatformDiagnosis) => combineLevel(row.level, probes[row.id])

  const summary = useMemo(() => {
    const counts = { ok: 0, warn: 0, error: 0 }
    for (const row of rows) counts[levelOf(row)]++
    return counts
  }, [rows, probes])

  const probedCount = useMemo(() => Object.values(probes).filter(probe => !probe.skipped).length, [probes])
  const skippedCount = useMemo(() => Object.values(probes).filter(probe => probe.skipped).length, [probes])

  const visible = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'page') return rows.filter(row => row.driver === 'page')
    if (filter === 'issue') return rows.filter(row => levelOf(row) !== 'ok')
    return rows.filter(row => levelOf(row) === 'ok')
  }, [rows, probes, filter])

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportLines(rows, probes).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，浏览器拒绝了剪贴板访问')
    }
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
  }

  const busy = loading || batch !== null || probingId !== null

  return (
    <div className="space-y-6">
      <section className="uga-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <ScanSearch className="h-4 w-4" />
              平台自检
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              轻量体检不发网络请求：比对适配器声明的能力、方法实现、Cookie 名与当前登录态，抓「声明能直发其实只能人工」
              「需要登录却没配 Cookie」这类配置矛盾。深度体检会在后台静默打开该平台入口页（用完即关、不保存），
              依次验证：是否被踢到登录页 / 被重定向 → 入口按钮是否点得进去 → 标题框 / 正文框是否命中 → 发布按钮是否存在，
              可选再试填一段测试文字确认「真的能输入」。每项都会给出结论，失败时直接告诉你哪一环断了。
              <span className="block pt-1 text-muted-foreground/80">
                未登录的平台会自动跳过深度体检（登录墙后面全是假故障），需要时可点「仍然探测」；纯人工平台不探测。
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-600"
                checked={dryFill}
                onChange={e => setDryFill(e.target.checked)}
                disabled={busy}
              />
              试填验证（写入测试文字，不保存）
            </label>
            <button className="uga-btn-secondary" onClick={runLight} disabled={busy}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? '体检中' : '重新体检'}
            </button>
            {batch ? (
              <button
                className="uga-btn-ghost"
                onClick={() => {
                  stopRef.current = true
                }}
              >
                <Square className="h-3.5 w-3.5" />
                停止
              </button>
            ) : (
              <button
                className="uga-btn-secondary"
                onClick={runAll}
                disabled={busy || probeTargets.length === 0}
                title="依次对所有页面驱动平台做深度体检，每个会短暂打开一个标签页"
              >
                <PlayCircle className="h-4 w-4" />
                全量页面体检（{probeTargets.length}）
              </button>
            )}
            <button className="uga-btn-ghost" onClick={copyReport} disabled={rows.length === 0}>
              <Copy className="h-4 w-4" />
              {copied ? '已复制' : '复制报告'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="uga-chip bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            正常 {summary.ok}
          </span>
          <span className="uga-chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            待确认 {summary.warn}
          </span>
          <span className="uga-chip bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            有问题 {summary.error}
          </span>
          <span className="uga-chip bg-muted text-muted-foreground">
            已探页面 {probedCount}/{probeTargets.length}
            {skippedCount > 0 ? `（跳过 ${skippedCount}）` : ''}
          </span>
          <div className="ml-auto flex gap-1">
            {(['all', 'issue', 'page', 'ok'] as Filter[]).map(key => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-2 py-1 ${
                  filter === key ? 'bg-background font-medium ring-1 ring-border' : 'text-muted-foreground'
                }`}
              >
                {key === 'all'
                  ? '全部'
                  : key === 'issue'
                    ? '只看有问题的'
                    : key === 'page'
                      ? '只看页面驱动'
                      : '只看正常'}
              </button>
            ))}
          </div>
        </div>

        {batch && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在体检 {batch.name}（{batch.index}/{batch.total}）——每个平台会短暂开一个后台标签页，请勿关闭浏览器
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}
      </section>

      <section className="uga-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2.5" />
              <th className="px-3 py-2.5 text-left font-medium">平台</th>
              <th className="px-3 py-2.5 text-left font-medium">结论</th>
              <th className="px-3 py-2.5 text-left font-medium">登录态</th>
              <th className="px-3 py-2.5 text-left font-medium">检查结果</th>
              <th className="px-3 py-2.5 text-right font-medium">深度体检</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const probe = probes[row.id]
              const level = combineLevel(row.level, probe)
              const Icon = LEVEL_ICON[level]
              const isOpen = expanded.includes(row.id)
              const canProbe = row.driver === 'page' && !row.manualOnly
              return (
                <Fragment key={row.id}>
                  <tr className="border-t align-top">
                    <td className="px-2 py-3 text-muted-foreground">
                      <button onClick={() => toggleExpanded(row.id)} title="展开详情">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platformId={row.id} icon={row.icon} name={row.name} size={16} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{row.name}</div>
                          <div className="text-[11px] text-muted-foreground">{row.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <span className={`uga-chip whitespace-nowrap ${conclusionClass(row.conclusion)}`}>{row.conclusion}</span>
                      {probe && !probe.skipped && probe.level !== 'ok' && (
                        <div className="mt-1">
                          <span className="uga-chip whitespace-nowrap bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            页面体检{probe.level === 'error' ? '未通过' : '待确认'}
                          </span>
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {row.driver === 'page' ? '页面驱动' : '接口同步'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {row.authMode === 'public' ? (
                        <span className="text-sky-600 dark:text-sky-400">无需登录</span>
                      ) : row.isAuthenticated ? (
                        <span className="text-green-600 dark:text-green-400">已登录</span>
                      ) : (
                        <span className="text-muted-foreground">未登录</span>
                      )}
                      {row.cookieNames.length > 0 && (
                        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                          <div className="break-all">Cookie：{row.cookieNames.join(' / ')}</div>
                          <div
                            className={
                              row.foundCookies.length > 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            命中 {row.foundCookies.length}/{row.cookieNames.length}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className={`flex items-center gap-1 font-medium ${LEVEL_CLASS[level]}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {level === 'ok' ? '正常' : level === 'warn' ? '待确认' : '有问题'}
                      </div>
                      {row.issues.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {row.issues.slice(0, 3).map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                          {row.issues.length > 3 && (
                            <li className="text-[11px]">…还有 {row.issues.length - 3} 条，展开查看</li>
                          )}
                        </ul>
                      )}
                      {probe && !probe.skipped && (
                        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                          <span className={probe.titleHit ? 'text-green-600' : 'text-red-600'}>
                            标题{probe.titleHit ? '✓' : '✗'}
                          </span>
                          <span className={probe.editorHit ? 'text-green-600' : 'text-red-600'}>
                            正文{probe.editorHit ? '✓' : '✗'}
                          </span>
                          <span className={probe.publishHit ? 'text-green-600' : 'text-amber-600'}>
                            发布键{probe.publishHit ? '✓' : '✗'}
                          </span>
                          {probe.fill?.attempted && (
                            <span
                              className={
                                probe.fill.titleOk && probe.fill.editorOk ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              试填{probe.fill.titleOk && probe.fill.editorOk ? '✓' : '✗'}
                            </span>
                          )}
                          {probe.elapsedMs !== undefined && (
                            <span className="text-muted-foreground">{(probe.elapsedMs / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                      )}
                      {probe?.skipped && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          <span>探测跳过：{probe.reason}</span>
                          {probe.reason?.includes('未登录') && (
                            <button
                              className="ml-2 underline decoration-dotted hover:text-foreground"
                              onClick={() => runProbe(row.id, true)}
                              disabled={busy}
                            >
                              仍然探测
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canProbe ? (
                        <button
                          className="uga-btn-secondary px-2 py-1 text-xs"
                          onClick={() => runProbe(row.id)}
                          disabled={busy}
                        >
                          {probingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          探测
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {row.manualOnly ? '纯人工，无需探测' : '接口平台，无需探测'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid gap-3 text-xs lg:grid-cols-2">
                          <div>
                            <div className="mb-1 font-medium">配置核对</div>
                            <ul className="space-y-0.5 text-muted-foreground">
                              <li>驱动：{row.driver === 'page' ? '页面填充' : '接口调用'}</li>
                              <li>能力：{row.capabilities.join(' / ') || '无'}</li>
                              <li>形态：{row.mode === 'submission' ? '投稿页（人工提交）' : row.mode === 'editor' ? '编辑器' : '—'}</li>
                              <li className="break-all">入口：{row.entryUrl || '—'}</li>
                              <li>
                                登录 Cookie：{row.cookieNames.join(' / ') || '未配置'}
                                {row.cookieNames.length > 0 && `（实测命中 ${row.foundCookies.join('/') || '无'}）`}
                              </li>
                            </ul>
                            {row.issues.length > 0 && (
                              <ul className="mt-2 space-y-0.5 text-muted-foreground">
                                {row.issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div>
                            <div className="mb-1 font-medium">页面体检</div>
                            {!probe && <p className="text-muted-foreground">还没探测，点右侧「探测」或顶部「全量页面体检」。</p>}
                            {probe?.skipped && <p className="text-muted-foreground">{probe.reason}</p>}
                            {probe && !probe.skipped && (
                              <div className="space-y-1.5">
                                {probe.checks.map(check => {
                                  const StatusIcon = STATUS_ICON[check.status]
                                  return (
                                    <div key={check.key} className="flex items-start gap-1.5">
                                      <StatusIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${STATUS_CLASS[check.status]}`} />
                                      <div>
                                        <span className="font-medium">{check.label}</span>
                                        <span className="text-muted-foreground">：{check.detail}</span>
                                      </div>
                                    </div>
                                  )
                                })}
                                {probe.counts && probe.counts.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                                      选择器命中明细（{probe.counts.length} 个）
                                    </summary>
                                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                                      {probe.counts.map((item, i) => (
                                        <li key={i}>
                                          [{item.group}] {item.selector} → 匹配 {item.matched} / 可见 {item.visible}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                                {probe.steps && probe.steps.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground">
                                    入口轨迹：
                                    {probe.steps
                                      .map(step => `${step.text}${step.clicked ? '✓' : '✗'}(${step.waitedMs}ms)`)
                                      .join(' → ')}
                                  </p>
                                )}
                                {probe.finalUrl && (
                                  <p className="break-all text-[11px] text-muted-foreground">最终地址：{probe.finalUrl}</p>
                                )}
                                {probe.issues.length > 0 && (
                                  <ul className="space-y-0.5 text-[11px] text-red-600 dark:text-red-400">
                                    {probe.issues.map((issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {loading ? '正在体检…' : rows.length === 0 ? '没有拿到平台列表，先看上面的报错' : '没有匹配的平台'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

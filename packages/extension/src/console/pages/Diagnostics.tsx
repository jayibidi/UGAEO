import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  PlayCircle,
  RefreshCw,
  ScanSearch,
  XCircle,
} from 'lucide-react'
import type { PlatformDiagnosis, PageProbeResult } from '../../lib/diagnostics'
import { PlatformIcon } from '../components/PlatformBadge'

type Filter = 'all' | 'issue' | 'ok'

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

export function DiagnosticsPage() {
  const [rows, setRows] = useState<PlatformDiagnosis[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [probes, setProbes] = useState<Record<string, PageProbeResult>>({})
  const [probingId, setProbingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const runLight = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_PLATFORMS' })
      if (response?.error) throw new Error(response.error)
      setRows((response?.platforms || []) as PlatformDiagnosis[])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runLight()
  }, [])

  const runProbe = async (platformId: string) => {
    setProbingId(platformId)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_PAGE', payload: { platformId } })
      if (response?.error) throw new Error(response.error)
      setProbes(prev => ({ ...prev, [platformId]: response?.result as PageProbeResult }))
    } catch (e) {
      setProbes(prev => ({
        ...prev,
        [platformId]: { ok: false, issues: [`✖ 探测失败：${(e as Error).message}`], level: 'error' },
      }))
    } finally {
      setProbingId(null)
    }
  }

  const summary = useMemo(() => {
    const counts = { ok: 0, warn: 0, error: 0 }
    for (const row of rows) counts[row.level]++
    return counts
  }, [rows])

  const visible = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'issue') return rows.filter(r => r.level !== 'ok')
    return rows.filter(r => r.level === 'ok')
  }, [rows, filter])

  const copyReport = async () => {
    const lines: string[] = [
      `UG·AEO 平台自检报告  ${new Date().toLocaleString()}`,
      `共 ${rows.length} 个平台：正常 ${summary.ok} / 待确认 ${summary.warn} / 有问题 ${summary.error}`,
      '',
    ]
    for (const row of rows) {
      const probe = probes[row.id]
      lines.push(`【${row.name}】${row.id}  ${row.layer === 'direct' ? '可直发' : '仅草稿'}  ${row.driver === 'page' ? '页面驱动' : '接口'}`)
      lines.push(
        `  登录态：${
          row.authMode === 'public' ? '无需登录' : row.isAuthenticated ? '已登录' : '未登录'
        }${row.foundCookies.length ? `（Cookie: ${row.foundCookies.join(',')}）` : ''}`
      )
      if (probe && !probe.skipped) {
        lines.push(
          `  页面探测：标题 ${probe.titleHit ? '命中' : '未命中'} / 正文 ${
            probe.editorHit ? '命中' : '未命中'
          } / 发布按钮 ${probe.publishHit ? '命中' : '未命中'}（${probe.finalUrl || ''}）`
        )
      }
      for (const issue of [...row.issues, ...(probe?.issues || [])]) lines.push(`  - ${issue}`)
      lines.push('')
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，浏览器拒绝了剪贴板访问')
    }
  }

  return (
    <div className="space-y-6">
      <section className="uga-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <ScanSearch className="h-4 w-4" />
              平台自检
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              轻量体检不发任何网络请求：比对适配器声明的能力、层级、Cookie 名与当前登录态，
              抓「声明能直发其实只能人工提交」「需要登录却没配 Cookie」这类配置矛盾。
              深度体检会在后台静默打开该平台入口页（用完即关），统计标题 / 正文 / 发布按钮选择器的命中情况，
              用来发现「页面改版导致填充失效」。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="uga-btn-secondary" onClick={runLight} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? '体检中' : '重新体检'}
            </button>
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
          <div className="ml-auto flex gap-1">
            {(['all', 'issue', 'ok'] as Filter[]).map(key => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-2 py-1 ${
                  filter === key ? 'bg-background font-medium ring-1 ring-border' : 'text-muted-foreground'
                }`}
              >
                {key === 'all' ? '全部' : key === 'issue' ? '只看有问题的' : '只看正常'}
              </button>
            ))}
          </div>
        </div>

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
              <th className="px-4 py-2.5 text-left font-medium">平台</th>
              <th className="px-3 py-2.5 text-left font-medium">能力</th>
              <th className="px-3 py-2.5 text-left font-medium">登录态</th>
              <th className="px-3 py-2.5 text-left font-medium">结论与问题</th>
              <th className="px-3 py-2.5 text-right font-medium">深度体检</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const Icon = LEVEL_ICON[row.level]
              const probe = probes[row.id]
              return (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <PlatformIcon name={row.name} size={16} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.name}</div>
                        <div className="text-[11px] text-muted-foreground">{row.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div>{row.layer === 'direct' ? '可直发' : '仅草稿'}</div>
                    <div>{row.kind === 'news' ? '资讯类' : '图文类'}</div>
                    <div>{row.driver === 'page' ? '页面驱动' : '接口同步'}</div>
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
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Cookie：{row.cookieNames.join(' / ')}
                        {row.foundCookies.length > 0 && (
                          <span className="text-green-600 dark:text-green-400">（命中 {row.foundCookies.length}）</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <div className={`flex items-center gap-1 font-medium ${LEVEL_CLASS[row.level]}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {row.level === 'ok' ? '正常' : row.level === 'warn' ? '待确认' : '有问题'}
                    </div>
                    {row.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {row.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    )}
                    {probe && (
                      <div className="mt-2 rounded-md bg-muted/50 p-2">
                        {probe.skipped ? (
                          <p className="text-muted-foreground">{probe.reason}</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-2">
                              <span className={probe.titleHit ? 'text-green-600' : 'text-red-600'}>
                                标题{probe.titleHit ? '✓' : '✗'}
                              </span>
                              <span className={probe.editorHit ? 'text-green-600' : 'text-red-600'}>
                                正文{probe.editorHit ? '✓' : '✗'}
                              </span>
                              <span className={probe.publishHit ? 'text-green-600' : 'text-amber-600'}>
                                发布键{probe.publishHit ? '✓' : '✗'}
                              </span>
                              {probe.loginWall && <span className="text-amber-600">要求登录</span>}
                            </div>
                            {probe.finalUrl && (
                              <p className="mt-1 break-all text-[11px] text-muted-foreground">{probe.finalUrl}</p>
                            )}
                            {probe.issues.length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                                {probe.issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {row.driver === 'page' ? (
                      <button
                        className="uga-btn-secondary px-2 py-1 text-xs"
                        onClick={() => runProbe(row.id)}
                        disabled={probingId === row.id}
                      >
                        {probingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlayCircle className="h-3.5 w-3.5" />
                        )}
                        探测
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">接口平台，无需探测</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {loading ? '正在体检…' : '没有匹配的平台'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

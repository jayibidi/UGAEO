import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Globe,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { AuthPill, ContentKindTag, PlatformIcon, PublishCapability } from '../components/PlatformBadge'
import { formatRelative, loginHint } from '../lib/format'
import { countByContentKind, groupByPublishLayer } from '@ugaeo/core'

type Filter = 'all' | 'authed' | 'unauthed'

export function AccountsPage() {
  const {
    platforms,
    cmsAccounts,
    lastCheckedAt,
    checkingAll,
    checkingId,
    refreshPlatforms,
    recheckOne,
    openPlatform,
    deleteCmsAccount,
    testCmsConnection,
    setNotice,
  } = useConsoleStore()

  const [filter, setFilter] = useState<Filter>('all')
  const [keyword, setKeyword] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; message?: string }>>({})

  const dslPlatforms = platforms.filter(p => p.sourceType !== 'cms')
  const authedCount = dslPlatforms.filter(p => p.isAuthenticated).length
  // 无需登录的平台也计入可用，但文案上要区分开，不能笼统说「已登录」
  const publicCount = dslPlatforms.filter(p => p.authMode === 'public').length

  const visible = useMemo(() => {
    return dslPlatforms
      .filter(p => (filter === 'all' ? true : filter === 'authed' ? p.isAuthenticated : !p.isAuthenticated))
      .filter(p => (keyword ? p.name.toLowerCase().includes(keyword.toLowerCase()) : true))
  }, [dslPlatforms, filter, keyword])

  // 按发布能力分两层：可直发在前，仅草稿在后；组内按接入优先级排序
  const grouped = useMemo(() => groupByPublishLayer(visible), [visible])
  const kindCount = useMemo(
    () => countByContentKind(dslPlatforms.filter(p => p.id !== 'zip-download')),
    [dslPlatforms]
  )

  // 用户去别的标签页登录完切回来时，自动重测一次还在「未登录」的平台
  const lastFocusCheck = useRef(0)
  const hasUnauthed = dslPlatforms.some(p => !p.isAuthenticated)
  useEffect(() => {
    const onFocus = () => {
      if (document.hidden || !hasUnauthed) return
      if (Date.now() - lastFocusCheck.current < 10_000) return
      lastFocusCheck.current = Date.now()
      refreshPlatforms(true).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [hasUnauthed, refreshPlatforms])

  const runCmsTest = async (id: string) => {    setTestingId(id)
    const result = await testCmsConnection(id)
    setTestResult(prev => ({ ...prev, [id]: result }))
    setTestingId(null)
    setNotice({
      kind: result.success ? 'ok' : 'error',
      text: result.success ? '站点连接正常' : `连接失败：${result.message || '未知错误'}`,
    })
  }

  return (
    <div className="space-y-6">
      <section className="uga-card flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{authedCount}</span>
          <span className="text-muted-foreground">
            / {dslPlatforms.length} 个平台可用
            {publicCount > 0 && <span className="text-muted-foreground/70">（含 {publicCount} 个无需登录）</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>图文类 {kindCount.graphic}</span>
          <span className="opacity-40">·</span>
          <span>资讯类 {kindCount.news}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {lastCheckedAt ? `上次检测 ${formatRelative(lastCheckedAt)}` : '本次会话尚未检测'}
        </span>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="uga-input w-56 pl-8"
            placeholder="搜索平台"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {([
            ['all', '全部'],
            ['authed', '已登录'],
            ['unauthed', '未登录'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-2.5 py-1 ${filter === key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button className="uga-btn-primary" onClick={() => refreshPlatforms(true)} disabled={checkingAll}>
          {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          全部重新检测
        </button>
      </section>

      {([
        {
          key: 'direct',
          title: '第一层 · 可直发',
          hint: '填完内容即可自动发布（部分平台先审后发）',
          items: grouped.direct,
        },
        {
          key: 'draft',
          title: '第二层 · 仅草稿',
          hint: '只能填入编辑器或投稿页，需要人工点发布 / 提交',
          items: grouped.draft,
        },
      ] as const).map(group => (
        <section key={group.key} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-medium">{group.title}</h2>
            <span className="uga-chip bg-muted text-muted-foreground">{group.items.length}</span>
            <span className="text-[11px] text-muted-foreground">{group.hint}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {group.items.map(platform => (
              <div key={platform.id} className="uga-card p-4">
                <div className="flex items-start gap-2.5">
                  <PlatformIcon icon={platform.icon} name={platform.name} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{platform.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <ContentKindTag platformId={platform.id} />
                      <PublishCapability platform={platform} />
                    </div>
                    <div className="mt-1">
                      <AuthPill
                        authed={platform.isAuthenticated}
                        username={platform.username}
                        authMode={platform.authMode}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex gap-1">
                  <button
                    className="uga-btn-secondary px-2 py-1 text-xs"
                    onClick={() => recheckOne(platform.id)}
                    disabled={checkingId === platform.id}
                  >
                    {checkingId === platform.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    重新检测
                  </button>
                  <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={() => openPlatform(platform)}>
                    <LogIn className="h-3.5 w-3.5" />
                    {platform.authMode === 'public' ? '打开入口页' : platform.isAuthenticated ? '打开主页' : '去登录'}
                  </button>
                </div>

                {!platform.isAuthenticated && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{loginHint(platform.name)}</p>
                    {platform.error && (
                      <p className="break-words text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                        {platform.error}
                      </p>
                    )}
                  </div>
                )}

                {platform.isAuthenticated && platform.error && (
                  <p className="mt-2 break-words text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                    {platform.error}
                  </p>
                )}
              </div>
            ))}

            {group.items.length === 0 && (
              <div className="uga-card col-span-full p-6 text-center text-xs text-muted-foreground">
                没有匹配的平台
              </div>
            )}
          </div>
        </section>
      ))}

      <section className="uga-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">自建站点</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              账号密码只保存在浏览器本地，控制台通过扩展后台调用站点接口验证
            </p>
          </div>
          <button
            className="uga-btn-secondary"
            onClick={() => chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE', path: '/accounts' }).catch(() => {})}
          >
            <Plus className="h-4 w-4" /> 添加站点
          </button>
        </div>

        {cmsAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            还没有自建站点，支持 WordPress / Typecho / MetaWeblog
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {cmsAccounts.map(account => {
              const result = testResult[account.id]
              return (
                <div key={account.id} className="rounded-lg border p-4">
                  <div className="flex items-start gap-2">
                    <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{account.name}</div>
                      <a
                        href={account.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-muted-foreground hover:underline"
                      >
                        {account.url}
                      </a>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {account.type} · {account.username || '未记录用户名'}
                      </div>
                    </div>
                  </div>

                  {result && (
                    <div
                      className={`mt-2 flex items-center gap-1 text-[11px] ${
                        result.success ? 'text-green-600 dark:text-green-400' : 'text-red-500'
                      }`}
                    >
                      {result.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {result.success ? '连接正常' : result.message}
                    </div>
                  )}

                  <div className="mt-3 flex gap-1">
                    <button
                      className="uga-btn-secondary px-2 py-1 text-xs"
                      onClick={() => runCmsTest(account.id)}
                      disabled={testingId === account.id}
                    >
                      {testingId === account.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      测试连接
                    </button>
                    <button
                      className="uga-btn-ghost px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => deleteCmsAccount(account.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> 删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

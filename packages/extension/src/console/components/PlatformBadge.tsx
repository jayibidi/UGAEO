import type { Platform, SyncResult } from '../lib/types'
import { CONTENT_KIND_LABEL, getPlatformProfile } from '@ugaeo/core'

export function PlatformIcon({ icon, name, size = 18 }: { icon?: string; name: string; size?: number }) {
  return (
    <img
      src={icon || '/assets/icon-48.png'}
      alt={name}
      width={size}
      height={size}
      className="flex-shrink-0 rounded"
      onError={(event) => {
        (event.target as HTMLImageElement).src = '/assets/icon-48.png'
      }}
    />
  )
}

export function AuthPill({
  authed,
  username,
  authMode,
}: {
  authed: boolean
  username?: string
  /** 'public' 表示平台不需要登录，不能显示成「已登录」 */
  authMode?: 'cookie' | 'public'
}) {
  if (authed && authMode === 'public') {
    return (
      <span className="uga-chip bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        无需登录
      </span>
    )
  }

  return authed ? (
    <span className="uga-chip bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      已登录{username ? ` · ${username}` : ''}
    </span>
  ) : (
    <span className="uga-chip bg-muted text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      未登录
    </span>
  )
}

export function PublishCapability({ platform }: { platform: Platform }) {
  const canPublish = (platform.capabilities || []).includes('publish')
  return canPublish ? (
    <span className="uga-chip border border-primary/30 text-primary">可直发</span>
  ) : (
    <span className="uga-chip bg-muted text-muted-foreground">仅草稿</span>
  )
}

/**
 * 内容形态标签：图文类 / 资讯类
 *
 * 只做展示，不参与分组 —— 层级由发布能力决定，形态是另一个维度。
 */
export function ContentKindTag({ platformId }: { platformId: string }) {
  const kind = getPlatformProfile(platformId).kind
  const cls =
    kind === 'news'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
  return <span className={`uga-chip ${cls}`}>{CONTENT_KIND_LABEL[kind]}</span>
}

export function ResultPill({ result }: { result: SyncResult }) {
  if (!result.success) {
    return <span className="uga-chip bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">失败</span>
  }
  if (result.reviewStatus === 'rejected') {
    return <span className="uga-chip bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">未过审</span>
  }
  if (result.reviewStatus === 'reviewing') {
    return <span className="uga-chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">审核中</span>
  }
  if (result.draftOnly) {
    return <span className="uga-chip bg-muted text-muted-foreground">草稿</span>
  }
  return <span className="uga-chip bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">已发布</span>
}

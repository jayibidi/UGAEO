import { Check } from 'lucide-react'
import { PlatformIcon, ResultPill } from './PlatformBadge'
import type { Platform, SyncResult } from '../lib/types'

interface SyncResultsProps {
  results: SyncResult[]
  platforms: Array<Pick<Platform, 'id' | 'name' | 'icon'>>
  /** 是否显示勾选框（草稿页签用来挑选要发布的草稿） */
  selectable?: boolean
  selected?: string[]
  onToggle?: (platformId: string) => void
  /** 只允许勾选这些平台（例如不支持草稿转发布的不给选） */
  selectableIds?: string[]
  emptyText?: string
}

/**
 * 同步结果列表
 *
 * 草稿和发布两个页签共用：差别只在「能不能勾选」，
 * 结果本身的展示规则必须一致，否则用户会对同一个平台看到两种结论。
 */
export function SyncResults({
  results,
  platforms,
  selectable = false,
  selected = [],
  onToggle,
  selectableIds,
  emptyText = '还没有执行结果',
}: SyncResultsProps) {
  if (!results.length) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">{emptyText}</p>
  }

  const nameOf = (id: string) => platforms.find(item => item.id === id)?.name || id
  const iconOf = (id: string) => platforms.find(item => item.id === id)?.icon
  const okCount = results.filter(result => result.success).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">本次结果</span>
        <span className="text-muted-foreground">
          {okCount} 成功 / {results.length - okCount} 失败
        </span>
      </div>

      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {results.map(result => {
          const allowed = !selectableIds || selectableIds.includes(result.platform)
          const checked = selected.includes(result.platform)
          const canCheck = selectable && result.success && allowed

          return (
            <div
              key={result.platform}
              className={`flex items-start gap-2 rounded-md px-1 py-1.5 text-xs ${
                canCheck ? 'cursor-pointer hover:bg-muted/60' : ''
              }`}
              onClick={() => canCheck && onToggle?.(result.platform)}
            >
              {selectable && (
                <span
                  className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                    checked && canCheck
                      ? 'border-primary bg-primary text-primary-foreground'
                      : allowed
                        ? 'border-border'
                        : 'border-dashed border-border/60 opacity-40'
                  }`}
                >
                  {checked && canCheck && <Check className="h-3 w-3" />}
                </span>
              )}

              <PlatformIcon
                icon={iconOf(result.platform)}
                name={result.platformName || nameOf(result.platform)}
                size={14}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{result.platformName || nameOf(result.platform)}</span>
                  <ResultPill result={result} />
                </div>
                {result.error && <div className="mt-0.5 line-clamp-2 text-red-500">{result.error}</div>}
                {result.message && !result.error && (
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{result.message}</div>
                )}
              </div>

              {result.postUrl && (
                <a
                  href={result.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={event => event.stopPropagation()}
                  className="flex-shrink-0 text-primary hover:underline"
                >
                  打开
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

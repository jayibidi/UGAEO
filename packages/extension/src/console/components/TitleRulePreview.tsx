/**
 * 标题规则预览
 *
 * 同步前就把「哪些平台的标题会被改、改到多少字」摊开给用户看。
 * 只跑规则那一层（不调模型），所以是同步计算，没有等待感；
 * AI 改写发生在真正同步时，这里只做说明。
 */
import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { adaptTitle, countChars, effectiveTitleMax, getPlatformRule } from '@ugaeo/core'
import { useConsoleStore } from '../lib/store'
import { PlatformIcon } from './PlatformBadge'

interface PreviewItem {
  id: string
  name: string
  from: number
  to: number
  action: string
  limit?: number
}

export function TitleRulePreview() {
  const { article, platforms, selectedPlatforms } = useConsoleStore()

  const items = useMemo<PreviewItem[]>(() => {
    if (!article || !selectedPlatforms.length) return []
    const nameById = new Map(platforms.map(platform => [platform.id, platform.name]))
    const bodyText = article.markdown || article.content || article.html || ''
    const title = (article.title || '').trim()

    return selectedPlatforms.flatMap<PreviewItem>(id => {
      const rule = getPlatformRule(id)
      const result = adaptTitle(id, title, bodyText, rule)
      const changed = result.action !== 'unchanged' || result.adapted !== title
      if (!changed) return []
      return [
        {
          id,
          name: nameById.get(id) || id,
          from: countChars(result.original || title),
          to: countChars(result.adapted),
          action: result.action,
          limit: effectiveTitleMax(rule),
        },
      ]
    })
  }, [article, platforms, selectedPlatforms])

  if (!items.length) return null

  const actionLabel = (action: string) => {
    if (action === 'truncated') return '截短'
    if (action === 'from-body') return '取正文首句'
    if (action === 'stripped') return '去符号'
    return '调整'
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        {items.length} 个平台的标题会被自动调整
      </div>
      <ul className="space-y-0.5">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-1.5">
            <PlatformIcon platformId={item.id} icon={platforms.find(p => p.id === item.id)?.icon} name={item.name} size={12} />
            <span className="truncate">{item.name}</span>
            <span className="text-amber-700 dark:text-amber-300">
              {item.from} → {item.to} 字
              {item.limit ? `（上限 ${item.limit}）` : ''}· {actionLabel(item.action)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">
        同步时会先让 AI 换个说法；AI 不可用或结果仍超长，就用按标点截断的版本，不影响发布。
      </p>
    </div>
  )
}

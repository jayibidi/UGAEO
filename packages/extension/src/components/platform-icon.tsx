import { useState } from 'react'
import { localPlatformIcon } from '../lib/platform-icons'

const MONOGRAM_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
]

/** 取 1～2 个字符当字母头像：中文取首字，英文取首字母（最多两个） */
function monogramText(name: string): string {
  const trimmed = (name || '?').trim()
  if (!trimmed) return '?'
  if (/^[\x00-\x7F]+$/.test(trimmed)) {
    const words = trimmed.split(/[\s\-_]+/).filter(Boolean)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return trimmed.slice(0, 2).toUpperCase()
  }
  return trimmed.slice(0, 1)
}

function colorOf(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  return MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length]
}

/**
 * 平台图标（控制台与弹窗共用）
 *
 * 优先级：本地打包图标（按 platformId）→ meta.icon 远程地址 → 带平台名的字母头像。
 *
 * 以前 icon 缺失或远程 favicon 挂掉时会退回扩展自己的 icon-48.png，
 * 结果一整列看起来都是同一个图标，用户根本分不清是哪个平台
 * （InfoQ 中文站把 /favicon.ico 302 成 HTML，八方资源网直接 403）。
 * 现在绝不退回扩展图标：要么是平台自己的标志，要么是能看出名字的字母头像。
 */
export function PlatformIcon({
  platformId,
  icon,
  name,
  size = 18,
}: {
  platformId?: string
  icon?: string
  name: string
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const src = failed ? undefined : localPlatformIcon(platformId) || icon || undefined

  if (!src) {
    return (
      <span
        aria-label={name}
        title={name}
        className="flex flex-shrink-0 select-none items-center justify-center rounded font-semibold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: colorOf(platformId || name),
          fontSize: Math.max(8, Math.round(size * 0.46)),
          lineHeight: 1,
        }}
      >
        {monogramText(name)}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      title={name}
      width={size}
      height={size}
      className="flex-shrink-0 rounded object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}

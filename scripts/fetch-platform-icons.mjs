/**
 * 抓取各平台的图标，落到扩展的 public/platform-icons 目录
 *
 * 为什么不用 meta.icon 的远程地址直接显示：
 * - 有些站点对 favicon 做了防盗链（b2b168.com 直接 403）
 * - 有些站点把 /favicon.ico 重写成首页 HTML（infoq.cn 返回 text/html）
 * - 结果就是列表里那两个平台显示成扩展自己的图标，用户看了会误解
 *
 * 用法：node scripts/fetch-platform-icons.mjs [--force]
 * 产物：
 *   packages/extension/public/platform-icons/<id>.<ext>
 *   packages/extension/src/lib/platform-icons.ts（id → 文件名映射，自动生成）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADAPTER_DIR = join(ROOT, 'packages/core/src/adapters/platforms')
const OUT_DIR = join(ROOT, 'packages/extension/public/platform-icons')
const MAP_FILE = join(ROOT, 'packages/extension/src/lib/platform-icons.ts')
const FORCE = process.argv.includes('--force')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36'

const EXT_BY_TYPE = {
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 从适配器源码里抠出 meta 的 id / name / icon / homepage */
function collectMetas() {
  const metas = []
  for (const file of readdirSync(ADAPTER_DIR)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue
    const source = readFileSync(join(ADAPTER_DIR, file), 'utf8')
    const blocks = source.split(/meta:\s*PlatformMeta\s*=\s*\{/)
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i].slice(0, blocks[i].indexOf('}'))
      // 引号风格不统一（多数单引号，eastmoney 用双引号），两种都认
      const field = (key) => new RegExp(`${key}:\\s*['"]([^'"]*)['"]`).exec(block)?.[1]
      const id = field('id')
      const name = field('name')
      const icon = field('icon') ?? ''
      const homepage = field('homepage') ?? ''
      if (id && name) metas.push({ id, name, icon, homepage, file })
    }
  }
  // excel / csv 这类非平台条目不抓
  return metas.filter(meta => !['zip-download'].includes(meta.id))
}

function sniffFormat(buffer) {
  const hex = (n) => buffer.subarray(0, n).toString('hex')
  if (hex(4) === '00000100') return 'ico'
  if (hex(8) === '89504e470d0a1a0a') return 'png'
  if (buffer.subarray(0, 3).toString() === 'GIF') return 'gif'
  if (hex(2) === 'ffd8') return 'jpg'
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp'
  const head = buffer.subarray(0, 400).toString('utf8').trim()
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) return 'svg'
  return null
}

async function fetchBinary(url, referer) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const ext = EXT_BY_TYPE[type]
    if (!ext) return { error: `不是图片（${type || 'no content-type'}）` }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 64) return { error: `文件过小（${buffer.length} B）` }
    // 有些站点 content-type 与内容不符（.ico 里塞 BMP / PNG），按真实字节判断，
    // 否则浏览器拿到 BMP-in-ICO 会直接渲染失败，又变成看不见的图标
    const real = sniffFormat(buffer)
    if (!real) return { error: `内容不是可用的图片格式（magic=${buffer.subarray(0, 4).toString('hex')}）` }
    return { buffer, ext: real }
  } catch (error) {
    return { error: error.message }
  }
}

/** 从首页 HTML 里找 <link rel="icon"> */
async function findIconFromHomepage(homepage) {
  try {
    const response = await fetch(homepage, {
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return []
    const base = new URL(response.url)
    const html = await response.text()
    const candidates = []
    const linkRe = /<link\b[^>]*>/gi
    for (const tag of html.match(linkRe) || []) {
      const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() || ''
      if (!/icon/.test(rel)) continue
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
      if (!href || href.startsWith('data:')) continue
      const absolute = new URL(href, base).toString()
      // apple-touch-icon 通常是大图，优先
      candidates.push({ url: absolute, weight: /apple-touch/.test(rel) ? 3 : /svg/.test(href) ? 2 : 1 })
    }
    candidates.push({ url: new URL('/favicon.ico', base).toString(), weight: 0 })
    return candidates.sort((a, b) => b.weight - a.weight).map(item => item.url)
  } catch {
    return []
  }
}

const metas = collectMetas()
mkdirSync(OUT_DIR, { recursive: true })

const result = {}
const failed = []

for (const meta of metas) {
  if (!FORCE && existsSync(MAP_FILE)) {
    // 已有映射且文件存在就跳过（--force 可全部重抓）
    const existing = readFileSync(MAP_FILE, 'utf8')
    const matched = new RegExp(`'${meta.id}':\\s*'([^']+)'`).exec(existing)
    if (matched && existsSync(join(OUT_DIR, matched[1]))) {
      result[meta.id] = matched[1]
      continue
    }
  }

  const tried = []
  let got = null

  if (meta.icon) {
    const attempt = await fetchBinary(meta.icon)
    tried.push(`${meta.icon} → ${attempt.error || 'ok'}`)
    if (!attempt.error) got = attempt
  }

  if (!got && meta.homepage) {
    const candidates = await findIconFromHomepage(meta.homepage)
    for (const url of candidates.slice(0, 4)) {
      const attempt = await fetchBinary(url, meta.homepage)
      tried.push(`${url} → ${attempt.error || 'ok'}`)
      if (!attempt.error) {
        got = attempt
        break
      }
    }
  }

  if (!got) {
    failed.push({ id: meta.id, name: meta.name, tried })
    continue
  }

  const filename = `${meta.id}.${got.ext}`
  writeFileSync(join(OUT_DIR, filename), got.buffer)
  result[meta.id] = filename
  console.log(`✓ ${meta.id.padEnd(16)} ${filename.padEnd(18)} ${got.buffer.length} B`)
}

// 清掉本次没抓到的旧文件，避免映射里剩下错的文件名
const keep = new Set(Object.values(result))
for (const file of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
  if (!keep.has(file)) writeFileSync(join(OUT_DIR, file), '')
}

const entries = Object.keys(result)
  .sort()
  .map(id => `  '${id}': '${result[id]}',`)
  .join('\n')

writeFileSync(
  MAP_FILE,
  `/**
 * 各平台的本地图标（自动生成，勿手改）
 *
 * 由 scripts/fetch-platform-icons.mjs 抓取，放在 public/platform-icons 下。
 * 远程 favicon 有防盗链和 302 到 HTML 的坑，所以统一打包到本地，
 * 打包后通过 chrome.runtime.getURL 取，离线也能显示。
 */
export const PLATFORM_ICON_FILES: Record<string, string> = {
${entries}
}

/** 取某个平台的本地图标地址；没有打包的返回 undefined，交给调用方兜底 */
export function localPlatformIcon(platformId?: string): string | undefined {
  if (!platformId) return undefined
  const file = PLATFORM_ICON_FILES[platformId]
  if (!file) return undefined
  try {
    return chrome.runtime.getURL(\`platform-icons/\${file}\`)
  } catch {
    return \`/platform-icons/\${file}\`
  }
}
`,
  'utf8'
)

console.log(`\n共 ${metas.length} 个平台，成功 ${Object.keys(result).length}，失败 ${failed.length}`)
for (const item of failed) {
  console.log(`✖ ${item.id} (${item.name})`)
  for (const line of item.tried) console.log(`    ${line}`)
}

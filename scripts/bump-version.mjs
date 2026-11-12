#!/usr/bin/env node
/**
 * 版本号统一脚本
 *
 * 为什么需要它：仓库里有 6 个地方写着版本号（根 package.json、4 个子包、扩展
 * manifest、Claude 插件清单）。手动改一定会漏 —— manifest 漏改，用户装上去看到的
 * 还是旧版本号；子包漏改，`pnpm bundle` 打出来的 zip 文件名和后缀对不上。
 *
 * 用法：
 *   node scripts/bump-version.mjs 2.4.3      # 指定版本
 *   node scripts/bump-version.mjs patch      # 按 patch/minor/major 递增
 *   node scripts/bump-version.mjs --check    # 只校验各处是否一致（CI 用）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 版本号的唯一真源：扩展 manifest（用户实际装到浏览器里的东西） */
const SOURCE = 'packages/extension/manifest.json'

/** 需要跟着改的文件 */
const TARGETS = [
  'package.json',
  'packages/core/package.json',
  'packages/extension/package.json',
  'packages/cli/package.json',
  'packages/mcp-server/package.json',
  'packages/extension/manifest.json',
  '.claude-plugin/plugin.json',
]

const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))
const writeJson = (rel, data) => writeFileSync(join(root, rel), `${JSON.stringify(data, null, 2)}\n`, 'utf8')

/**
 * 源码里写死的版本号。
 *
 * 这些地方没法从 package.json 读：CLI 是 tsup 打包后全局安装的单文件，
 * core 的 VERSION 常量的用途是运行时自报版本，所以只能靠脚本同步 + CI 校验。
 */
const TEXT_TARGETS = [
  { rel: 'packages/core/src/index.ts', re: /(export const VERSION = ')(\d+\.\d+\.\d+)(')/, label: 'core VERSION' },
  { rel: 'packages/cli/src/index.ts', re: /(\.version\(')(\d+\.\d+\.\d+)('\))/, label: 'cli --version' },
  { rel: 'packages/mcp-server/src/index.ts', re: /(version: ')(\d+\.\d+\.\d+)(')/g, label: 'mcp index' },
  { rel: 'packages/mcp-server/src/server.ts', re: /(version: ')(\d+\.\d+\.\d+)(')/g, label: 'mcp server' },
]

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  if (!m) throw new Error(`版本号不合法：${v}（需要 x.y.z）`)
  return m.slice(1).map(Number)
}

function bump(base, kind) {
  const [major, minor, patch] = parseVersion(base)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  return kind // 直接给了版本号
}

/** 读取源码里第一个匹配到的版本号（用于 --check） */
function readTextVersion({ rel, re }) {
  if (!existsSync(join(root, rel))) return null
  const m = re.exec(readFileSync(join(root, rel), 'utf8'))
  return m ? m[2] : null
}

/** 收集现状，用于 --check 与报错 */
function collect() {
  const jsonRows = TARGETS.filter(existsSync).map((rel) => ({ rel, version: readJson(rel).version }))
  const textRows = TEXT_TARGETS.map((t) => ({ rel: t.rel, version: readTextVersion(t) })).filter((r) => r.version)
  return [...jsonRows, ...textRows]
}

const arg = process.argv[2]

if (!arg || arg === '--check') {
  const rows = collect()
  const versions = [...new Set(rows.map((r) => r.version))]
  for (const r of rows) console.log(`${r.version.padEnd(8)} ${r.rel}`)
  if (versions.length > 1) {
    console.error(`\n✗ 版本号不一致：${versions.join(' / ')}`)
    console.error('  运行 `pnpm version:bump <版本>` 统一')
    process.exit(1)
  }
  console.log(`\n✓ 全部一致：${versions[0]}`)
  process.exit(0)
}

const current = readJson(SOURCE).version
const next = bump(current, arg)
parseVersion(next) // 校验

for (const rel of TARGETS) {
  if (!existsSync(join(root, rel))) continue
  const data = readJson(rel)
  const before = data.version
  data.version = next
  writeJson(rel, data)
  console.log(`${before} → ${next}  ${rel}`)
}

for (const target of TEXT_TARGETS) {
  if (!existsSync(join(root, target.rel))) continue
  const before = readTextVersion(target)
  const src = readFileSync(join(root, target.rel), 'utf8')
  // 保持正则里的引号/括号，只换中间的版本号；g 标记的会一次换完同文件所有出现
  const out = src.replace(target.re, (_m, p1, _v, p3) => `${p1}${next}${p3}`)
  if (out !== src) writeFileSync(join(root, target.rel), out, 'utf8')
  console.log(`${(before || '?').padEnd(8)} → ${next}  ${target.rel}  (${target.label})`)
}

console.log(`
下一步（手动确认后再执行）：
  1. 更新 CHANGELOG.md，把「未发布」改成 ${next} 并写日期
  2. pnpm typecheck && pnpm test
  3. pnpm bundle                        # 产出 ugaeo-v${next}.zip
  4. git add -A && git commit -m "chore(release): v${next}"
  5. git tag -a v${next} -m "v${next}" && git push --follow-tags
  6. GitHub 上建 Release，附上 ugaeo-v${next}.zip
`)

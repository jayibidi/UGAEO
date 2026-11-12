#!/usr/bin/env node
/**
 * 打包扩展为可分发 zip
 *
 * 为什么不用 PowerShell 的 Compress-Archive：
 *   Windows PowerShell 5.1 在 .NET Framework 上生成的 zip，条目名使用反斜杠
 *   （如 `assets\icon-48.png`）。Chrome 解包时按 `/` 查找路径，会报
 *   "Could not load icon 'assets/icon-48.png' specified in 'action'"。
 *
 * 这个脚本自己写 zip 结构，强制使用 `/` 作为分隔符，零依赖、跨平台。
 *
 * 用法：
 *   node scripts/pack-extension.mjs [源目录] [输出 zip]
 *   默认：packages/extension/dist -> ugaeo-v<version>.zip（仓库根目录）
 */
import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const srcDir = resolve(process.argv[2] || join(repoRoot, 'packages/extension/dist'))

if (!existsSync(srcDir)) {
  console.error(`[pack] 源目录不存在：${srcDir}\n先运行 pnpm build`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'))
const outFile = resolve(process.argv[3] || join(repoRoot, `ugaeo-v${manifest.version}.zip`))

/** 递归收集文件，返回 [{ abs, rel }]，rel 一律使用 / */
function walk(dir, acc = [], base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, acc, base)
    else if (entry.isFile()) acc.push({ abs, rel: relative(base, abs).split(sep).join('/') })
  }
  return acc
}

// CRC32（zip 必需）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 构造一个 zip 条目（deflate 压缩，内容更小） */
function buildEntry(name, data) {
  const nameBuf = Buffer.from(name, 'utf8')
  const crc = crc32(data)
  const deflated = deflateRawSync(data, { level: 9 })
  // 压缩后反而更大时改用 store
  const useDeflate = deflated.length < data.length
  const body = useDeflate ? deflated : data
  const method = useDeflate ? 8 : 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // local file header 签名
  local.writeUInt16LE(20, 4) // 需要版本 2.0
  local.writeUInt16LE(0x0800, 6) // flag：UTF-8 文件名
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(0, 10) // 修改时间
  local.writeUInt16LE(0x21, 12) // 修改日期（1980-01-01，保证可复现）
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28) // extra field 长度

  return {
    name,
    nameBuf,
    crc,
    method,
    body,
    local: Buffer.concat([local, nameBuf, body]),
    size: data.length,
  }
}

const files = walk(srcDir)
const entries = []
const chunks = []
let offset = 0

for (const { abs, rel } of files) {
  const entry = buildEntry(rel, readFileSync(abs))
  entry.offset = offset
  chunks.push(entry.local)
  offset += entry.local.length
  entries.push(entry)
}

// 中央目录
const centralParts = []
for (const e of entries) {
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4) // 创建版本
  central.writeUInt16LE(20, 6) // 需要版本
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(e.method, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0x21, 14)
  central.writeUInt32LE(e.crc, 16)
  central.writeUInt32LE(e.body.length, 20)
  central.writeUInt32LE(e.size, 24)
  central.writeUInt16LE(e.nameBuf.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // 磁盘号
  central.writeUInt16LE(0, 36) // 内部属性
  central.writeUInt32LE(0, 38) // 外部属性
  central.writeUInt32LE(e.offset, 42)
  centralParts.push(central, e.nameBuf)
}

const centralDir = Buffer.concat(centralParts)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(centralDir.length, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20)

const stream = createWriteStream(outFile)
for (const chunk of chunks) stream.write(chunk)
stream.write(centralDir)
stream.end(end)

stream.on('finish', () => {
  const size = (statSync(outFile).size / 1024 / 1024).toFixed(2)
  console.log(`[pack] ${entries.length} 个文件 -> ${outFile}`)
  console.log(`[pack] ${size} MB，路径分隔符统一为 /`)
})
stream.on('error', err => {
  console.error('[pack] 写入失败：', err)
  process.exit(1)
})

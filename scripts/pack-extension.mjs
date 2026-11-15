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
 * ⚠️ manifest.json 必须、必须、必须放在 zip 根目录（平铺），不能套一层
 *   `ugaeo-v<版本>/`。Chrome 在 chrome://extensions 里拉入 zip 安装时，是把
 *   zip 当扩展包解压的，根目录找不到 manifest.json 直接报
 *   "Could not unzip extension for install"（v2.5.3 就这么翻车的）。
 *   用户要的是「拉进去就能装」，不是「解压出来再选目录」。
 *
 * 安装说明不放进 zip（多出来的文件会被当成扩展内容），单独输出到 zip 同目录的
 * `<包名>-安装说明.html` / `.txt`，随 Release 一起发。
 *
 * 用法：
 *   node scripts/pack-extension.mjs [源目录] [输出 zip] [--no-docs]
 *   默认：packages/extension/dist -> ugaeo-v<version>.zip（仓库根目录）
 */
import { createWriteStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

// --flat 是历史参数，现在打包恒为 flat（zip 根目录即扩展根），保留只为兼容旧命令。
const noDocs = process.argv.includes('--no-docs')
const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const srcDir = resolve(positional[0] || join(repoRoot, 'packages/extension/dist'))

if (!existsSync(srcDir)) {
  console.error(`[pack] 源目录不存在：${srcDir}\n先运行 pnpm build`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'))
const version = manifest.version
const outFile = resolve(positional[1] || join(repoRoot, `ugaeo-v${version}.zip`))

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

/** 安装说明：纯文本 + 可直接双击打开的 HTML（放在 zip 外面，别混进扩展包） */
function installDocs(ver) {
  const steps = [
    `UG·AEO | 新媒体中心 v${ver}`,
    '',
    '【方式一 · 直接拖进去装（最快，Chrome / Edge / 360 极速都行）】',
    '1) 打开扩展管理页：',
    '   · Chrome / Edge：地址栏输入 chrome://extensions',
    '   · 360 极速浏览器：右上角菜单 → 工具 → 管理扩展',
    '2) 打开右上角的「开发者模式」开关（必须先打开，否则拖入不会安装）',
    '3) 把这个 zip 文件直接拖到扩展页面上，松手',
    '4) 弹出「要添加 UG·AEO 吗？」→ 点「添加扩展程序」',
    '',
    '【方式二 · 解压后加载（方式一被浏览器策略拦住时用）】',
    '1) 把 zip 解压到任意文件夹（例如 D:\\ugaeo）',
    '2) 扩展页 → 开启「开发者模式」',
    '3) 点「加载已解压的扩展程序」，选解压出来的那个文件夹（里面能看到 manifest.json）',
    '',
    '常见问题：',
    '· 报「Could not unzip extension for install」＝这个 zip 不是扩展包格式（manifest.json 不在根目录），',
    '  换官方发布的 zip，或者改用方式二。',
    '· 拖进去没反应 / 只出现下载任务 ＝ 开发者模式没打开，或浏览器是企业策略禁用。',
    '  360 极速、QQ 等第三方内核浏览器可以直接拖 crx 安装（Chrome 官方版不行）。',
    '· 提示「Manifest file is missing or unreadable」＝方式二选错了目录，要选 manifest.json 那一层。',
    '· 提示「此扩展需要更高版本的 Chrome」＝内核低于 102，Chrome 请升级，360 极速用 X 版或 13+。',
    '· 装好后点扩展图标开弹窗；完整控制台在弹窗右上角「控制台」。',
    '',
    '升级：删掉旧版本再按上面装一次即可；登录态存在浏览器 Cookie 里，不会丢。',
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>UG·AEO v${ver} 安装说明</title>
<style>
  body{font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#1f2328}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:#656d76;font-size:13px;margin-bottom:24px}
  h2{font-size:16px;margin:26px 0 10px}
  ol{padding-left:22px}
  li{margin:8px 0}
  code{background:#f6f8fa;padding:2px 6px;border-radius:4px;font-size:13px}
  .ok{background:#dafbe1;border:1px solid #4ac26b;border-radius:8px;padding:12px 16px;margin:18px 0}
  .warn{background:#fff8c5;border:1px solid #d4a72c;border-radius:8px;padding:12px 16px;margin:18px 0}
  table{border-collapse:collapse;width:100%;margin-top:12px;font-size:14px}
  td,th{border:1px solid #d0d7de;padding:8px 10px;text-align:left}
  th{background:#f6f8fa}
</style>
</head>
<body>
<h1>UG·AEO | 新媒体中心 v${ver}</h1>
<div class="sub">Chrome / Edge / 360 极速浏览器 安装说明</div>

<div class="ok">
  <b>最快的方式：直接把 zip 拖进扩展页。</b><br>
  先打开扩展页并开启「开发者模式」，再把 <code>ugaeo-v${ver}.zip</code> 拖进去，弹窗点「添加扩展程序」即可。
</div>

<h2>方式一 · 拖进去装</h2>
<ol>
  <li>打开扩展管理页：Chrome / Edge 地址栏输入 <code>chrome://extensions</code>；360 极速：菜单 →「工具」→「管理扩展」</li>
  <li>打开右上角 <b>开发者模式</b>（不开的话拖入只会弹下载，不会安装）</li>
  <li>把 zip 文件拖到扩展页面上松手</li>
  <li>点「添加扩展程序」</li>
</ol>

<h2>方式二 · 解压后加载</h2>
<ol>
  <li>把 zip 解压到任意文件夹</li>
  <li>扩展页 → 开启 <b>开发者模式</b></li>
  <li>点 <b>加载已解压的扩展程序</b>，选中解压出来的文件夹（能看到 <code>manifest.json</code> 那一层）</li>
</ol>

<div class="warn">
  <b>为什么有的电脑拖 zip 会变成「下载」？</b><br>
  两种情况：① 开发者模式没打开；② 浏览器或企业策略禁止了外部扩展安装。<br>
  这时改用<b>方式二</b>；360 极速、QQ 浏览器也可以直接拖 <code>.crx</code> 装（Chrome 官方版从 2021 年起不允许）。
</div>

<h2>报错对照</h2>
<table>
<tr><th>提示</th><th>原因 / 处理</th></tr>
<tr><td>Could not unzip extension for install</td><td>zip 结构不对（manifest.json 不在根目录），换官方 zip 或用方式二</td></tr>
<tr><td>Manifest file is missing or unreadable</td><td>方式二选错目录，要选 <code>manifest.json</code> 所在那一层</td></tr>
<tr><td>此扩展需要更高版本的 Chrome</td><td>内核低于 102；Chrome 升级，360 极速用 X 版或 13+</td></tr>
<tr><td>拖入后只出现下载任务</td><td>开发者模式未开启，或策略禁止；走方式二</td></tr>
<tr><td>点图标没反应</td><td>扩展页看是否有红色报错，点「错误」看堆栈</td></tr>
</table>

<h2>升级与卸载</h2>
<p>升级：删掉旧版本后重新装一次；登录态存在浏览器 Cookie 里，不会丢。<br>
卸载：扩展页点「移除」即可，本扩展不会在系统里留下其他文件。</p>
</body>
</html>
`
  return [
    // 加 BOM，Windows 记事本打开不乱码
    { name: `${basename(outFile, '.zip')}-安装说明.txt`, content: '\ufeff' + steps },
    { name: `${basename(outFile, '.zip')}-安装说明.html`, content: html },
  ]
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

// 说明文件写到 zip 外面（放进 zip 会变成扩展内的多余文件，也可能让校验变脏）
if (!noDocs) {
  for (const doc of installDocs(version)) {
    writeFileSync(join(dirname(outFile), doc.name), doc.content, 'utf8')
  }
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
  const hasManifestAtRoot = entries.some(e => e.name === 'manifest.json')
  console.log(`[pack] ${entries.length} 个文件 -> ${outFile}`)
  console.log(`[pack] ${size} MB，manifest.json ${hasManifestAtRoot ? '在根目录 ✓（可直接拖入扩展页安装）' : '不在根目录 ✗'}`)
  if (!noDocs) console.log(`[pack] 安装说明已输出到同目录：${basename(outFile, '.zip')}-安装说明.html`)
  if (!hasManifestAtRoot) {
    console.error('[pack] 致命：zip 根目录没有 manifest.json，Chrome 会报 Could not unzip extension')
    process.exit(1)
  }
})
stream.on('error', err => {
  console.error('[pack] 写入失败：', err)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * 生成可双击安装的 .crx（CRX3 格式）
 *
 * 为什么还要做 crx：
 *   Chrome 官方版从 2021 年起禁止本地安装 crx（拖进去只弹下载），但 360 极速、
 *   QQ 浏览器、以及配置了企业策略的 Chrome 仍然认 crx，双击就能装。
 *   对用户来说这比「解压 + 开发者模式 + 选目录」顺手得多。
 *
 * 私钥放在 scripts/.crx-key.pem（已 gitignore）。首次运行自动生成，
 * 同一台机器后续构建沿用同一把钥匙 —— 扩展 ID 因此保持稳定。
 * 换机器重新生成会得到新的 ID，等于换了个扩展（设置不共享），这一点要知道。
 *
 * CRX3 结构（Chromium 官方 components/crx_file/crx3.proto）：
 *   "Cr24" | uint32LE(3) | uint32LE(headerLen) | CrxFileHeader | zip
 *   CrxFileHeader {
 *     repeated AsymmetricKeyProof sha256_with_rsa = 2;   // public_key(1) + signature(2)
 *     optional bytes signed_header_data = 10000;         // SignedData { crx_id = 1 }
 *   }
 *   签名原文 = "CRX3 SignedData\0" | uint32LE(len(signed_header_data)) | signed_header_data | zip
 *
 * 用法：node scripts/make-crx.mjs [zip 路径]
 */
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const KEY_PATH = join(here, '.crx-key.pem')

const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages/extension/dist/manifest.json'), 'utf8'))
const explicitZip = process.argv[2]

/**
 * 取 crx 载荷用的 zip
 *
 * crx 里的 zip 必须把 manifest.json 放在**根目录**。分发用的 zip 现在也是这个
 * 结构（见 pack-extension.mjs 的说明），所以理论上可以直接拿来当载荷；
 * 这里仍然现场生成一份，是为了保证打包内容和 dist 完全同步。
 */
let zipPath
let tempZip = null
if (explicitZip) {
  zipPath = resolve(explicitZip)
  if (!existsSync(zipPath)) {
    console.error(`[crx] 找不到 zip：${zipPath}`)
    process.exit(1)
  }
} else {
  tempZip = join(repoRoot, `.crx-payload-${manifest.version}.zip`)
  execFileSync(
    process.execPath,
    [join(here, 'pack-extension.mjs'), join(repoRoot, 'packages/extension/dist'), tempZip, '--no-docs'],
    { stdio: 'inherit' }
  )
  zipPath = tempZip
}

// ── 1. 私钥 ──
let pem
if (existsSync(KEY_PATH)) {
  pem = readFileSync(KEY_PATH, 'utf8')
} else {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  writeFileSync(KEY_PATH, pem, { mode: 0o600 })
  console.log('[crx] 已生成新私钥 scripts/.crx-key.pem（不要提交、不要外传）')
}
const privateKey = createPrivateKey(pem)
const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })

// ── 2. crx_id = sha256(公钥 DER) 前 16 字节 ──
const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16)
// 扩展 ID 的算法：16 字节转 hex，再把每个 hex 位 0-f 映射成 a-p
const extensionId = [...crxId.toString('hex')].map(ch => String.fromCharCode(97 + parseInt(ch, 16))).join('')

// ── 3. protobuf 小工具 ──
const varint = value => {
  const out = []
  let n = value
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  out.push(n)
  return Buffer.from(out)
}
/** 长度前缀字段：tag = (field << 3) | 2 */
const bytesField = (field, payload) => Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])

const signedData = bytesField(1, crxId) // SignedData { crx_id }
const zipBuffer = readFileSync(zipPath)

// ── 4. 签名 ──
const digestInput = Buffer.concat([
  Buffer.from('CRX3 SignedData\0', 'binary'),
  (() => {
    const len = Buffer.alloc(4)
    len.writeUInt32LE(signedData.length, 0)
    return len
  })(),
  signedData,
  zipBuffer,
])
const signature = sign('sha256', digestInput, privateKey)

const keyProof = Buffer.concat([bytesField(1, publicKeyDer), bytesField(2, signature)])
const header = Buffer.concat([
  bytesField(2, keyProof), // sha256_with_rsa
  bytesField(10000, signedData), // signed_header_data
])

// ── 5. 组装 ──
const prefix = Buffer.alloc(12)
prefix.write('Cr24', 0, 'binary')
prefix.writeUInt32LE(3, 4)
prefix.writeUInt32LE(header.length, 8)

const outPath = join(repoRoot, `ugaeo-v${manifest.version}.crx`)
const crx = Buffer.concat([prefix, header, zipBuffer])
writeFileSync(outPath, crx)

// ── 6. 自校验：能按 CRX3 解析回来、签名验得过、内层 zip 与源 zip 完全一致 ──
const check = readFileSync(outPath)
const magicOk = check.subarray(0, 4).toString('binary') === 'Cr24'
const versionOk = check.readUInt32LE(4) === 3
const headerLen = check.readUInt32LE(8)
const innerZip = check.subarray(12 + headerLen)
const sameZip = createHash('sha256').update(innerZip).digest('hex') === createHash('sha256').update(zipBuffer).digest('hex')
const verifyOk = (() => {
  try {
    return verify('sha256', digestInput, createPublicKey(privateKey), signature)
  } catch {
    return false
  }
})()

if (!magicOk || !versionOk || !sameZip || !verifyOk) {
  console.error(`[crx] 自校验失败 magic=${magicOk} version=${versionOk} zip=${sameZip} sign=${verifyOk}`)
  process.exit(1)
}

console.log(`[crx] ${outPath}`)
console.log(`[crx] ${(statSync(outPath).size / 1024 / 1024).toFixed(2)} MB，header ${headerLen} B，签名与内层 zip 校验通过`)
console.log(`[crx] 扩展 ID：${extensionId}`)

// 临时载荷用完即删，别把 flat zip 混在发布产物里
if (tempZip && existsSync(tempZip)) rmSync(tempZip, { force: true })

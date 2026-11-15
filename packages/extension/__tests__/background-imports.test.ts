/**
 * 架构守卫：后台 service worker 里禁止动态 import
 *
 * 踩过的坑（v2.5.1 自检页整页空白，报 "document is not defined"）：
 * MV3 的 service worker 没有 DOM，而 Vite 会把 `await import('...')` 包成
 * __vitePreload(async () => import(...), deps)，该 helper 为了预加载 CSS 会去摸
 * document.getElementsByTagName / document.head，一执行就抛错。
 *
 * 所以 background 目录下一律用静态 import。这个测试就是防止以后又写回去。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BACKGROUND_DIR = join(__dirname, '../src/background')

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walk(full))
    } else if (entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('background service worker', () => {
  it('不出现 await import(...)（Vite 会包成 __vitePreload，SW 里没有 document）', () => {
    const offenders: string[] = []
    for (const file of walk(BACKGROUND_DIR)) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      // 允许静态 import，只盯动态导入
      if (/await\s+import\s*\(/.test(source)) {
        offenders.push(file.replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('自检消息走的是静态导入的 handler', () => {
    const index = readFileSync(join(BACKGROUND_DIR, 'index.ts'), 'utf8')
    expect(index).toContain("from '../lib/diagnostics'")
    expect(index).toContain('case \'DIAGNOSE_PLATFORMS\'')
    expect(index).toContain('case \'DIAGNOSE_PAGE\'')
  })
})

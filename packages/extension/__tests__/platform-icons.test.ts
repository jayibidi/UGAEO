/**
 * 图标守卫：每个内置平台都必须有自己的图标文件
 *
 * 踩过的坑：图标缺失或远程 favicon 挂掉时，界面统一退回扩展自己的 icon-48.png，
 * 整列看起来都是同一个图标（InfoQ 中文站的 /favicon.ico 302 成 HTML、
 * 八方资源网直接 403），用户根本分不清是哪个平台。
 *
 * 现在图标由 scripts/fetch-platform-icons.mjs 抓到 public/platform-icons，
 * 这个测试保证「新加平台时别忘了抓图标」。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PLATFORM_ICON_FILES, localPlatformIcon } from '../src/lib/platform-icons'

const ICON_DIR = join(__dirname, '../public/platform-icons')

/** 不是内容平台的条目（本地导出工具之类）不要求图标 */
const NOT_A_PLATFORM = new Set(['zip-download'])

// vitest.setup.ts 把 @ugaeo/core 整体 mock 掉了（只留 adapterRegistry），
// 这里要真实适配器清单，用 importActual 绕过 mock 拿原始模块
async function platformIds(): Promise<string[]> {
  const core = await vi.importActual<typeof import('@ugaeo/core')>('@ugaeo/core')
  return core.BUILT_IN_ADAPTERS.map(Adapter => new Adapter().meta)
    .filter(meta => !NOT_A_PLATFORM.has(meta.id))
    .map(meta => meta.id)
}

describe('平台图标', () => {
  it('每个内置平台都有映射', async () => {
    const missing = (await platformIds()).filter(id => !PLATFORM_ICON_FILES[id])
    expect(missing).toEqual([])
  })

  it('映射到的文件真实存在', () => {
    const missingFiles = Object.entries(PLATFORM_ICON_FILES)
      .filter(([, file]) => !existsSync(join(ICON_DIR, file)))
      .map(([id, file]) => `${id} → ${file}`)
    expect(missingFiles).toEqual([])
  })

  it('同一个文件不会被两个平台共用（否则又变成"图标全一样"）', () => {
    const seen = new Map<string, string>()
    const shared: string[] = []
    for (const [id, file] of Object.entries(PLATFORM_ICON_FILES)) {
      const owner = seen.get(file)
      if (owner) shared.push(`${file}: ${owner} / ${id}`)
      else seen.set(file, id)
    }
    expect(shared).toEqual([])
  })

  it('非图片格式的扩展名会被拦下来（BMP 伪装成 .ico 浏览器渲染不出来）', () => {
    const bad = Object.entries(PLATFORM_ICON_FILES)
      .filter(([, file]) => !/\.(ico|png|svg|jpg|jpeg|webp|gif)$/i.test(file))
      .map(([id, file]) => `${id} → ${file}`)
    expect(bad).toEqual([])
  })

  it('localPlatformIcon 在没有 chrome 环境时也能给出路径', () => {
    expect(localPlatformIcon('zhihu')).toContain('platform-icons/')
    expect(localPlatformIcon('not-exist')).toBeUndefined()
    expect(localPlatformIcon(undefined)).toBeUndefined()
  })
})

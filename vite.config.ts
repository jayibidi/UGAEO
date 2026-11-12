import { defineConfig } from 'vite'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { createExtensionConfig } from './packages/extension/vite.shared'

/**
 * 仓库根目录的 Vite 配置。
 *
 * 这个 monorepo 里唯一的 Vite 应用是 `packages/extension`，根目录本身没有入口。
 * 之前直接在根目录执行 `vite build` 会落到 Vite 的默认行为去找根目录的
 * `index.html`，从而报错：Could not resolve entry module "index.html"。
 *
 * 这里把配置转发给扩展包的工厂函数，所以：
 *   - 在根目录跑 `npm run build` / `npx vite build`  → 构建扩展
 *   - 在 packages/extension 里跑                     → 行为完全一致
 */
function resolveExtensionDir(): string {
  const candidates = [
    resolve(__dirname, 'packages/extension'),
    resolve(process.cwd(), 'packages/extension'),
  ]

  const found = candidates.find((dir) => existsSync(resolve(dir, 'manifest.json')))
  if (!found) {
    throw new Error(
      '未找到 packages/extension/manifest.json，请在仓库根目录或 packages/extension 下执行构建'
    )
  }
  return found
}

export default defineConfig(({ mode }) => createExtensionConfig(resolveExtensionDir(), mode))

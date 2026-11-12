import { loadEnv, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import * as yamlModule from '@modyfi/vite-plugin-yaml'
import * as tailwindModule from 'tailwindcss'
import * as autoprefixerModule from 'autoprefixer'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import baseManifest from './manifest.json'

/**
 * 兼容 CJS / ESM 两种打包结果。
 * 从仓库根目录加载配置时配置会被打成 CJS，此时 `import yaml from '...'`
 * 可能落到 `{ default: fn }` 上，直接调用会报 "default is not a function"。
 */
function interop<_T extends (...args: never[]) => unknown>(mod: unknown): _T {
  const m = mod as Record<string, unknown>
  return ((m?.default as Record<string, unknown>)?.default ?? m?.default ?? m) as _T
}

const yaml = interop<() => { name: string }>(yamlModule)
const tailwindcss = interop<(opts?: unknown) => unknown>(tailwindModule)
const autoprefixer = interop<() => unknown>(autoprefixerModule)

/**
 * 复制静态文件并修改 manifest 的插件
 *
 * 注意：这里显式接收 packageDir，而不是依赖 __dirname。
 * 因为从仓库根目录加载配置时，Vite 会把配置打包到根目录的临时文件里执行，
 * __dirname 会变成仓库根目录，导致所有相对路径错位。
 */
function copyStaticFilesPlugin(packageDir: string) {
  return {
    name: 'copy-static-files',
    writeBundle() {
      // 复制 rules 目录
      const rulesDir = resolve(packageDir, 'rules')
      const distRulesDir = resolve(packageDir, 'dist/rules')

      if (existsSync(rulesDir)) {
        if (!existsSync(distRulesDir)) {
          mkdirSync(distRulesDir, { recursive: true })
        }

        const files = readdirSync(rulesDir)
        for (const file of files) {
          copyFileSync(resolve(rulesDir, file), resolve(distRulesDir, file))
          console.log(`[copy-static] Copied rules/${file}`)
        }
      }

      // 复制 reader 脚本（避免被 vite 转换为 ES modules）
      const readerDir = resolve(packageDir, 'public/lib')
      const distDir = resolve(packageDir, 'dist')

      if (existsSync(readerDir)) {
        const readerFiles = ['reader.js', 'Readability.js']
        for (const file of readerFiles) {
          const srcPath = resolve(readerDir, file)
          const destPath = resolve(distDir, file)
          if (existsSync(srcPath)) {
            copyFileSync(srcPath, destPath)
            console.log(`[copy-static] Copied ${file} to dist/`)
          }
        }
      }

      // 修改输出的 manifest.json，添加 reader 脚本到 content_scripts
      const manifestPath = resolve(packageDir, 'dist/manifest.json')
      if (existsSync(manifestPath)) {
        const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'))

        // 在 content_scripts 开头添加 reader 脚本
        // 不设置 world，使用默认的 ISOLATED world，与 extractor 共享全局变量
        const readerContentScript = {
          js: ['reader.js', 'Readability.js'],
          matches: ['http://*/*', 'https://*/*'],
          run_at: 'document_start',
        }

        // 添加到 content_scripts 数组开头
        manifestContent.content_scripts = [readerContentScript, ...manifestContent.content_scripts]

        writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2))
        console.log('[copy-static] Updated manifest.json with reader scripts')
      }
    },
  }
}

/**
 * 生成扩展的 Vite 配置。
 *
 * @param packageDir `packages/extension` 的绝对路径
 * @param mode       Vite 的 mode（development / production）
 *
 * 抽成工厂函数后，`packages/extension/vite.config.ts` 与仓库根目录的
 * `vite.config.ts` 可以共用同一份配置，不再出现「在根目录跑 vite build
 * 找不到 index.html」的问题。
 */
export function createExtensionConfig(packageDir: string, mode: string): UserConfig {
  const env = loadEnv(mode, packageDir, '')
  const isDev = mode === 'development'

  return {
    // 显式指定 root，保证无论从哪个目录启动，入口、public/、dist/ 都指向扩展包
    root: packageDir,
    plugins: [react(), yaml(), crx({ manifest: baseManifest }), copyStaticFilesPlugin(packageDir)],
    define: {
      'import.meta.env.VITE_GA_MEASUREMENT_ID': JSON.stringify(env.VITE_GA_MEASUREMENT_ID || ''),
      'import.meta.env.VITE_GA_API_SECRET': JSON.stringify(env.VITE_GA_API_SECRET || ''),
      // 开发模式下覆盖 PROD 标志，让 logger 输出 debug 日志
      'import.meta.env.PROD': JSON.stringify(!isDev),
      'import.meta.env.DEV': JSON.stringify(isDev),
    },
    resolve: {
      alias: {
        '@': resolve(packageDir, 'src'),
        '@ugaeo/core': resolve(packageDir, '../core/src'),
      },
    },
    css: {
      // 显式指定 PostCSS 插件与 Tailwind 配置文件：
      // 从仓库根目录构建时，Vite 会按 cwd 去找 postcss.config.js，
      // 找不到就会用空配置的 tailwind，报 "border-border class does not exist"。
      postcss: {
        plugins: [
          tailwindcss({ config: resolve(packageDir, 'tailwind.config.js') }) as never,
          autoprefixer() as never,
        ],
      },
    },
    build: {
      // 开发模式: 不压缩，生成 sourcemap
      minify: isDev ? false : 'esbuild',
      sourcemap: isDev ? 'inline' : false,
      outDir: resolve(packageDir, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(packageDir, 'src/popup/index.html'),
          editor: resolve(packageDir, 'src/editor/index.html'),
          'sync-dialog': resolve(packageDir, 'src/sync-dialog/index.html'),
          preprocessor: resolve(packageDir, 'src/preprocessor/index.html'),
          // 独立 WEB 控制台（账号状态 / 同步记录 / 失败处理）
          console: resolve(packageDir, 'src/console/index.html'),
        },
      },
    },
  }
}

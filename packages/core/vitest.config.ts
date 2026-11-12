import { defineConfig } from 'vitest/config'

/**
 * core 包的测试配置
 *
 * 必须显式声明 root：仓库根目录有一份 vite.config.ts（转发给扩展包构建），
 * 否则从 core 里跑 vitest 会向上找到它，把测试根目录错误地指到 packages/extension。
 */
export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // 沙箱环境里并行 worker 偶尔起不来会导致测试文件被静默跳过，这里串行执行保证结果稳定
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    cache: false,
  },
})

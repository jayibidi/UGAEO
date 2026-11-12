import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts'],
    // 沙箱/受限环境里并行 worker 会因临时目录 EPERM 静默丢测试文件，串行执行更稳
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    cache: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

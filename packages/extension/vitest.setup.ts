/**
 * Chrome API Mock
 * 用于在 Node.js 环境下测试 Chrome 扩展代码
 */
import { vi, beforeEach } from 'vitest'

// 内存存储，模拟 chrome.storage.local
const mockStorage: Record<string, any> = {}

// Mock chrome API
const chromeMock = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
  },
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorage[keys] })
        }
        const result: Record<string, any> = {}
        keys.forEach(key => {
          result[key] = mockStorage[key]
        })
        return Promise.resolve(result)
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(mockStorage, items)
        return Promise.resolve()
      }),
      remove: vi.fn((keys: string | string[]) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys
        keysArray.forEach(key => delete mockStorage[key])
        return Promise.resolve()
      }),
    },
  },
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
  },
}

// 挂载到全局
;(global as any).chrome = chromeMock

// Mock adapterRegistry（用于测试 adapters/index.ts）
interface MockPlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
}

interface MockAdapter {
  checkAuth: ReturnType<typeof vi.fn>
  publish?: ReturnType<typeof vi.fn>
  init?: ReturnType<typeof vi.fn>
  meta?: MockPlatformMeta
}

const mockAdapterRegistry = {
  metas: [] as MockPlatformMeta[],
  adapters: {} as Record<string, MockAdapter>,
  runtime: null as any,
}

// Mock @ugaeo/core 模块
// 平台规则与规则适配是纯函数（不碰 chrome / DOM），直接透传真实实现，
// 免得每个用到它的测试都要自己 mock 一遍。
vi.mock('@ugaeo/core', async () => {
  const actual = await vi.importActual<typeof import('@ugaeo/core')>('@ugaeo/core')
  return {
    adapterRegistry: {
      setRuntime: vi.fn((runtime: any) => {
        mockAdapterRegistry.runtime = runtime
      }),
      register: vi.fn(),
      getAllMeta: vi.fn(() => mockAdapterRegistry.metas),
      get: vi.fn(async (platformId: string) => {
        const adapter = mockAdapterRegistry.adapters[platformId]
        if (adapter) {
          return {
            ...adapter,
            init: adapter.init || vi.fn().mockResolvedValue(undefined),
            meta: mockAdapterRegistry.metas.find(m => m.id === platformId),
          }
        }
        return null
      }),
    },
    // 与 core 里同名实现保持一致：本地导出工具不是内容平台，各类统计/列表都不算它
    LOCAL_TOOL_PLATFORM_IDS: ['zip-download'],
    isLocalToolPlatform: (platformId: string) => platformId === 'zip-download',
    // 规则表与适配（纯函数）
    PLATFORM_RULES: actual.PLATFORM_RULES,
    getPlatformRule: actual.getPlatformRule,
    platformPreconditions: actual.platformPreconditions,
    adaptTitle: actual.adaptTitle,
    countChars: actual.countChars,
    effectiveTitleMax: actual.effectiveTitleMax,
    truncateTitle: actual.truncateTitle,
    titleFromBody: actual.titleFromBody,
    // AI 默认配置（设置页与发布设置都要用）
    DEFAULT_AI_BASE_URL: actual.DEFAULT_AI_BASE_URL,
    DEFAULT_AI_MODEL: actual.DEFAULT_AI_MODEL,
    // AI 发布计划用的纯函数（标签数量、摘要长度、平台调性）
    tagCountFor: actual.tagCountFor,
    summaryMaxFor: actual.summaryMaxFor,
    platformStyleHint: actual.platformStyleHint,
    // 三层分层（可直发 / AI 自动发布 / 词条平台）与内容形态
    resolvePublishLayer: actual.resolvePublishLayer,
    groupByPublishLayer: actual.groupByPublishLayer,
    PLATFORM_PROFILES: actual.PLATFORM_PROFILES,
    getPlatformProfile: actual.getPlatformProfile,
    CONTENT_KIND_LABEL: actual.CONTENT_KIND_LABEL,
  }
})

// Mock analytics（避免实际追踪）
vi.mock('../src/lib/analytics', () => ({
  trackSyncStart: vi.fn().mockResolvedValue(undefined),
  trackPlatformSync: vi.fn().mockResolvedValue(undefined),
  trackSyncComplete: vi.fn().mockResolvedValue(undefined),
  trackPlatformCombination: vi.fn().mockResolvedValue(undefined),
  trackUsageTime: vi.fn().mockResolvedValue(undefined),
  trackMilestone: vi.fn().mockResolvedValue(undefined),
  trackAuthCheck: vi.fn().mockResolvedValue(undefined),
  updateCumulativeStats: vi.fn().mockResolvedValue(undefined),
  inferErrorType: vi.fn((error: string) => error),
}))

// Mock runtime
vi.mock('../src/runtime/extension', () => ({
  createExtensionRuntime: vi.fn(() => ({
    fetch: vi.fn(),
    uploadImage: vi.fn(),
    getCookies: vi.fn(),
  })),
}))

// Mock logger
vi.mock('../src/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// 导出以便测试中使用
export { chromeMock, mockStorage, mockAdapterRegistry }

// 每个测试前重置
beforeEach(() => {
  vi.clearAllMocks()
  // 清空 mock storage
  Object.keys(mockStorage).forEach(key => delete mockStorage[key])
})

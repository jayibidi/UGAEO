/**
 * AI 设置的兼容与提示文案
 *
 * 三件事必须有保障：
 * 1. 老版本存的数据里没有 imageModel，读出来不能是 undefined（界面会显示 "undefined"）；
 * 2. 编辑器面板要能说清「到底缺什么」——没填 Key 和开关没开是两件事；
 * 3. 生图可用性只看生图模型，不能拿文本模型顶。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_SETTINGS,
  describeAIBlocker,
  getAISettings,
  isImageReady,
  saveAISettings,
  type AISettings,
} from '../src/lib/ai-settings'

const READY: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  apiKey: 'sk-test',
  model: 'deepseek-v4.1-flash',
  imageModel: 'doubao-seedream-4-0-250828',
}

beforeEach(() => {
  // vitest.setup.ts 里 beforeEach 会清空 mock storage
})

describe('旧版本数据兼容', () => {
  it('没有 imageModel / imageModels 字段时给空值，而不是 undefined', async () => {
    await chrome.storage.local.set({
      aiSettings: { enabled: true, apiKey: 'sk-x', model: 'gpt-4o', models: ['gpt-4o'] },
    })

    const settings = await getAISettings()
    expect(settings.imageModel).toBe('')
    expect(settings.imageModels).toEqual([])
    expect(settings.model).toBe('gpt-4o')
  })

  it('保存生图模型后能读回来', async () => {
    await saveAISettings({ imageModel: 'flux-1.1-pro', imageModels: ['flux-1.1-pro'] })
    const settings = await getAISettings()
    expect(settings.imageModel).toBe('flux-1.1-pro')
    expect(settings.imageModels).toEqual(['flux-1.1-pro'])
  })
})

describe('isImageReady', () => {
  it('只配了文本模型不算生图可用', () => {
    expect(isImageReady({ ...READY, imageModel: '' })).toBe(false)
    expect(isImageReady({ ...READY, imageModel: 'seedream' })).toBe(true)
  })

  it('没开开关或没 Key 都不算可用', () => {
    expect(isImageReady({ ...READY, enabled: false })).toBe(false)
    expect(isImageReady({ ...READY, apiKey: '' })).toBe(false)
  })
})

describe('describeAIBlocker', () => {
  it('缺 Key 时优先提示去加 API', () => {
    const blocker = describeAIBlocker({ ...READY, apiKey: '  ' }, 'text')
    expect(blocker?.fix).toBe('apiKey')
    expect(blocker?.message).toContain('API Key')
  })

  it('Key 有了但开关没开，要说开关没开', () => {
    const blocker = describeAIBlocker({ ...READY, enabled: false }, 'text')
    expect(blocker?.fix).toBe('enable')
    expect(blocker?.message).toContain('开关')
  })

  it('文案模式缺文本模型 / 配图模式缺生图模型分别提示', () => {
    expect(describeAIBlocker({ ...READY, model: '' }, 'text')?.message).toContain('文本模型')
    expect(describeAIBlocker({ ...READY, imageModel: '' }, 'image')?.message).toContain('生图模型')
  })

  it('配置齐全时没有阻塞项', () => {
    expect(describeAIBlocker(READY, 'text')).toBeNull()
    expect(describeAIBlocker(READY, 'image')).toBeNull()
  })
})

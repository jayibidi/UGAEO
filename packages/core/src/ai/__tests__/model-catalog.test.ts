/**
 * 模型库分类
 *
 * 设置页要把「文本模型」和「生图模型」分成两个下拉，分类错了用户就选不到东西：
 * - 生图模型漏判 → 配图功能空列表
 * - 编辑类（flux-kontext / inpaint）被当成文生图 → 用户选完画不出图
 * - embedding / whisper 被塞进文本模型 → 选中后所有 AI 功能报错
 */
import { describe, expect, it } from 'vitest'
import {
  classifyModel,
  extractEndpointTypes,
  pickDefaultModel,
  splitModelCatalog,
} from '../model-catalog'

describe('classifyModel', () => {
  it('常见生图模型判为 image', () => {
    const ids = [
      'doubao-seedream-4-0-250828',
      'dall-e-3',
      'gpt-image-1',
      'flux-1.1-pro',
      'stable-diffusion-3.5-large',
      'sdxl-turbo',
      'qwen-image',
      'cogview-4',
      'seedream-3.0',
      'nano-banana',
      'wanx2.1-t2i-turbo',
      'imagen-4.0-generate',
    ]
    for (const id of ids) {
      expect(classifyModel(id), id).toBe('image')
    }
  })

  it('图生图 / 编辑 / 放大类不算文生图', () => {
    for (const id of ['flux-kontext-pro', 'sd-inpaint-v2', 'some-model-upscale']) {
      expect(classifyModel(id), id).toBe('other')
    }
  })

  it('对话模型判为 chat', () => {
    for (const id of ['gpt-4o', 'gpt-4o-mini', 'deepseek-v4.1-flash', 'claude-sonnet-4-5', 'qwen-max']) {
      expect(classifyModel(id), id).toBe('chat')
    }
  })

  it('向量 / 语音 / 视频 / 审核模型不进文本模型', () => {
    for (const id of [
      'text-embedding-3-large',
      'bge-reranker-v2',
      'whisper-1',
      'tts-1-hd',
      'gpt-4o-audio-preview',
      'veo-3',
      'kling-v2',
    ]) {
      expect(classifyModel(id), id).toBe('other')
    }
  })

  it('网关给了能力声明时以声明为准', () => {
    // 名字看不出来，但网关说能生图
    expect(classifyModel('my-custom-model', ['openai', 'image-generation'])).toBe('image')
    // 名字像生图，但网关说它是图生图编辑
    expect(classifyModel('flux-pro', ['image-edit'])).toBe('other')
    // 网关说能聊天
    expect(classifyModel('my-custom-model', ['openai'])).toBe('chat')
  })
})

describe('extractEndpointTypes', () => {
  it('兼容字符串、数组、对象三种写法', () => {
    expect(extractEndpointTypes({ supported_endpoint_types: 'openai,image-generation' })).toEqual([
      'openai',
      'image-generation',
    ])
    expect(extractEndpointTypes({ supported_endpoint_types: ['openai'] })).toEqual(['openai'])
    expect(
      extractEndpointTypes({ supported_endpoint_types: [{ endpoint: 'Image-Generation' }] })
    ).toEqual(['image-generation'])
    expect(extractEndpointTypes({})).toEqual([])
  })
})

describe('splitModelCatalog', () => {
  it('分组统计且标记是否拿到元信息', () => {
    const catalog = splitModelCatalog([
      { id: 'gpt-4o' },
      { id: 'deepseek-v4.1-flash' },
      { id: 'doubao-seedream-4-0-250828', supported_endpoint_types: ['image-generation'] },
      { id: 'text-embedding-3-large' },
    ])

    expect(catalog.chat).toEqual(['deepseek-v4.1-flash', 'gpt-4o'])
    expect(catalog.image).toEqual(['doubao-seedream-4-0-250828'])
    expect(catalog.other).toEqual(['text-embedding-3-large'])
    expect(catalog.total).toBe(4)
    expect(catalog.metaAvailable).toBe(true)
  })

  it('没有任何元信息时 metaAvailable=false（界面要提示按名称识别）', () => {
    const catalog = splitModelCatalog([{ id: 'gpt-4o' }, { id: 'flux-1.1-pro' }])
    expect(catalog.metaAvailable).toBe(false)
    expect(catalog.image).toEqual(['flux-1.1-pro'])
  })
})

describe('pickDefaultModel', () => {
  it('文本模型优先 gpt-4o-mini / deepseek', () => {
    expect(pickDefaultModel(['claude-sonnet-4-5', 'gpt-4o-mini', 'gpt-4o'])).toBe('gpt-4o-mini')
    expect(pickDefaultModel(['claude-sonnet-4-5', 'deepseek-v4.1-flash'])).toBe('deepseek-v4.1-flash')
  })

  it('生图模型优先 seedream / dall-e / gpt-image', () => {
    expect(pickDefaultModel(['flux-1.1-pro', 'doubao-seedream-4-0-250828'], 'image')).toBe(
      'doubao-seedream-4-0-250828'
    )
  })

  it('列表为空返回空串', () => {
    expect(pickDefaultModel([], 'image')).toBe('')
  })
})

describe('视频类不能混进生图下拉', () => {
  // 实测 api.ugooto-ai.com：这些都被网关声明成 image-generation
  const videoCases = [
    'kling-video-v4',
    'kling-video-v4-flash',
    'pixverse-video',
    'pixverse-image-template',
    'viduq3-pro',
    'viduq2-turbo',
    'veo_3_1-fast',
    'doubao-seedance-1-0',
    'aigc-image-kling',
    'hunyuan-video',
  ]

  it.each(videoCases)('%s 归到 other', id => {
    expect(classifyModel(id, ['image-generation'])).toBe('other')
  })

  it('真正的生图模型不受影响', () => {
    expect(classifyModel('doubao-seedream-4-0-250828', ['image-generation'])).toBe('image')
    expect(classifyModel('gpt-image-1', ['image-generation'])).toBe('image')
    expect(classifyModel('qwen-image-3.0', ['image-generation'])).toBe('image')
  })

  it('MJ 的操作类（上传 / 放大）不当作生图', () => {
    expect(classifyModel('mj_upload', ['image-generation'])).toBe('other')
    expect(classifyModel('mj_upscale', ['image-generation'])).toBe('other')
  })
})

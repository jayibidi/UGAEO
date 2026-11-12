import { describe, expect, it } from 'vitest'
import { resolveDraftOnlyMap, hasPublishAction, DEFAULT_PUBLISH_SETTINGS } from '../src/lib/publish-settings'

const platforms = [
  { id: 'zhihu', capabilities: ['article', 'draft', 'publish'] },
  { id: 'weibo', capabilities: ['article', 'draft'] },
]

describe('resolveDraftOnlyMap', () => {
  it('草稿模式全部为 true', () => {
    const map = resolveDraftOnlyMap({ ...DEFAULT_PUBLISH_SETTINGS, mode: 'draft' }, ['zhihu', 'weibo'], platforms)
    expect(map).toEqual({ zhihu: true, weibo: true })
    expect(hasPublishAction(map)).toBe(false)
  })

  it('发布模式下仅支持 publish 的平台为 false', () => {
    const map = resolveDraftOnlyMap({ ...DEFAULT_PUBLISH_SETTINGS, mode: 'publish' }, ['zhihu', 'weibo'], platforms)
    expect(map.zhihu).toBe(false)
    expect(map.weibo).toBe(true)
    expect(hasPublishAction(map)).toBe(true)
  })

  it('平台覆盖设置优先于全局模式', () => {
    const map = resolveDraftOnlyMap(
      { ...DEFAULT_PUBLISH_SETTINGS, mode: 'publish', platformOverrides: { zhihu: 'draft' } },
      ['zhihu'],
      platforms
    )
    expect(map.zhihu).toBe(true)
  })

  it('定时模式按发布处理', () => {
    const map = resolveDraftOnlyMap({ ...DEFAULT_PUBLISH_SETTINGS, mode: 'scheduled' }, ['zhihu'], platforms)
    expect(map.zhihu).toBe(false)
  })

  it('未知平台默认允许发布（由适配器兜底降级）', () => {
    const map = resolveDraftOnlyMap({ ...DEFAULT_PUBLISH_SETTINGS, mode: 'publish' }, ['cms_1'], platforms)
    expect(map.cms_1).toBe(false)
  })
})

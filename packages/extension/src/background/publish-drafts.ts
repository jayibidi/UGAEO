/**
 * 草稿转发布
 *
 * 场景：用户在控制台选「存为草稿」同步一遍，确认内容没问题后，
 * 再挑出成功的几篇直接发布（立即或定时）。
 *
 * 关键约束：只有声明了 publish_existing_draft 能力的平台才能对「原来那篇草稿」
 * 发布。其余平台我们不做「重新创建一篇」的兜底 —— 那会在平台里留下两篇内容，
 * 用户很难自己清理。这类平台直接返回失败并附带草稿链接，让人去后台点一下。
 */
import { getAdapter } from '../adapters'
import type { DraftRef, SyncResult as CoreSyncResult } from '@ugaeo/core'

/** core 的 SyncResult 不带平台名，这里补上供界面直接展示 */
export type SyncResult = CoreSyncResult & { platformName?: string }
import { createLogger } from '../lib/logger'

const logger = createLogger('PublishDrafts')

export interface DraftPublishHooks {
  onResult?: (result: SyncResult) => void
}

export const UNSUPPORTED_DRAFT_PUBLISH = '该平台不支持草稿转发布，请到平台后台点发布'

/**
 * 依次发布多篇已存在的草稿
 *
 * 串行执行：这些请求都带登录态、打的是平台接口，并发容易触发风控。
 */
export async function publishDraftRefs(
  refs: DraftRef[],
  hooks: DraftPublishHooks = {}
): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  for (const ref of refs) {
    const push = (result: SyncResult) => {
      results.push(result)
      hooks.onResult?.(result)
    }

    try {
      const adapter = await getAdapter(ref.platform)
      if (!adapter) {
        push({
          platform: ref.platform,
          success: false,
          error: '未找到该平台的适配器',
          postUrl: ref.postUrl,
          timestamp: Date.now(),
        })
        continue
      }

      if (!adapter.publishExistingDraft) {
        push({
          platform: ref.platform,
          platformName: adapter.meta.name,
          success: false,
          error: UNSUPPORTED_DRAFT_PUBLISH,
          postUrl: ref.postUrl,
          timestamp: Date.now(),
        })
        continue
      }

      const result = await adapter.publishExistingDraft(ref)
      logger.debug(`${ref.platform} draft publish:`, result.success ? 'ok' : result.error)
      push({ ...result, platformName: adapter.meta.name })
    } catch (error) {
      logger.error(`Draft publish failed for ${ref.platform}:`, error)
      push({
        platform: ref.platform,
        success: false,
        error: `草稿转发布失败：${(error as Error).message}`,
        postUrl: ref.postUrl,
        timestamp: Date.now(),
      })
    }
  }

  return results
}

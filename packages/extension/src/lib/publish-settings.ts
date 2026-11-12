/**
 * 发布设置：草稿 / 自动发布 / 定时发布
 */
export const PUBLISH_SETTINGS_KEY = 'publishSettings'

/** 发布模式 */
export type PublishMode = 'draft' | 'publish' | 'scheduled'

/** 单个平台的发布偏好 */
export type PlatformPublishMode = 'draft' | 'publish'

export interface PublishSettings {
  /** 全局发布模式 */
  mode: PublishMode
  /** 定时发布延迟（分钟） */
  delayMinutes: number
  /** 按平台的覆盖设置，未设置则跟随全局 */
  platformOverrides: Record<string, PlatformPublishMode>
}

export const DEFAULT_PUBLISH_SETTINGS: PublishSettings = {
  mode: 'draft',
  delayMinutes: 30,
  platformOverrides: {},
}

export const PUBLISH_MODE_LABEL: Record<PublishMode, string> = {
  draft: '存为草稿',
  publish: '立即发布',
  scheduled: '定时发布',
}

function normalize(raw: Partial<PublishSettings> | undefined): PublishSettings {
  if (!raw) {
    return { ...DEFAULT_PUBLISH_SETTINGS, platformOverrides: {} }
  }
  return {
    ...DEFAULT_PUBLISH_SETTINGS,
    ...raw,
    platformOverrides: { ...(raw.platformOverrides || {}) },
  }
}

export async function getPublishSettings(): Promise<PublishSettings> {
  const result = await chrome.storage.local.get(PUBLISH_SETTINGS_KEY)
  return normalize(result[PUBLISH_SETTINGS_KEY] as Partial<PublishSettings> | undefined)
}

export async function savePublishSettings(patch: Partial<PublishSettings>): Promise<PublishSettings> {
  const current = await getPublishSettings()
  const next = normalize({ ...current, ...patch })
  await chrome.storage.local.set({ [PUBLISH_SETTINGS_KEY]: next })
  return next
}

/**
 * 计算本次同步中每个平台是否「直接发布」
 *
 * @param settings 发布设置
 * @param platformIds 目标平台
 * @param platforms 平台元信息（含 capabilities）
 */
export function resolveDraftOnlyMap(
  settings: PublishSettings,
  platformIds: string[],
  platforms?: Array<{ id: string; capabilities?: string[] }>
): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  const capabilityMap = new Map((platforms || []).map(p => [p.id, p.capabilities || []]))

  for (const id of platformIds) {
    const override = settings.platformOverrides[id]
    const mode = override || (settings.mode === 'draft' ? 'draft' : 'publish')

    if (mode === 'draft') {
      map[id] = true
      continue
    }

    // 平台未声明 publish 能力时，仍然传 false，由适配器降级为草稿并给出提示
    const capabilities = capabilityMap.get(id)
    if (capabilities && capabilities.length > 0 && !capabilities.includes('publish')) {
      map[id] = true
    } else {
      map[id] = false
    }
  }

  return map
}

/** 本次是否包含「发布」动作 */
export function hasPublishAction(map: Record<string, boolean>): boolean {
  return Object.values(map).some(draftOnly => !draftOnly)
}

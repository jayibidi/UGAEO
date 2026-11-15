import { LogIn, Check, Lock } from 'lucide-react'
import { isLocalToolPlatform } from '@ugaeo/core'
import { useConsoleStore } from '../lib/store'
import { AuthPill, PlatformIcon, PublishCapability } from './PlatformBadge'
import { splitPlatformsByMode } from '../lib/publish-flow'

/**
 * 平台选择器
 *
 * 两种模式看到的平台不一样，这是两个页签「行为不同」的第一层体现：
 * - 存为草稿：**全部平台**（34 个）都能收草稿，未登录的标出来，同步前先登录
 * - 立即发布：只有「已登录 + 声明了 publish 能力」的平台可选，其余锁住并说明原因
 */
export function PlatformPicker() {
  const {
    platforms,
    selectedPlatforms,
    togglePlatform,
    openPlatform,
    loadingPlatforms,
    publishMode,
    setSelected,
    setNotice,
  } = useConsoleStore()

  const { selectable, locked } = splitPlatformsByMode(platforms, publishMode)
  const isPublishMode = publishMode === 'publish'
  // 草稿模式下列表已经是全量（含未登录），不用再单列一次
  const unauthed = isPublishMode
    ? platforms.filter(platform => !platform.isAuthenticated && !isLocalToolPlatform(platform.id))
    : []

  if (!platforms.length) {
    return (
      <div className="uga-card p-6 text-sm text-muted-foreground">
        {loadingPlatforms ? '正在检测平台登录状态…' : '没有可用平台，请打开扩展弹窗完成初始化。'}
      </div>
    )
  }

  const selectAllSelectable = () => {
    setSelected(selectable.map(platform => platform.id))
  }

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {isPublishMode ? '可直发平台' : '全部平台'}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{selectable.length} 个</span>
          </h3>
          <div className="flex gap-1">
            <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={selectAllSelectable}>
              全选
            </button>
            <button
              className="uga-btn-ghost px-2 py-1 text-xs"
              onClick={() => useConsoleStore.getState().deselectAll()}
            >
              清空
            </button>
          </div>
        </div>

        {selectable.length === 0 ? (
          <div className="uga-card p-5 text-sm text-muted-foreground">
            {isPublishMode ? (
              <>
                还没有可直发的平台。去「<span className="text-foreground">账号</span>」页登录知乎、掘金、CSDN
                这类支持自动发布的平台，或者切到「存为草稿」用全部平台。
              </>
            ) : (
              <>没有读取到平台列表，请打开扩展弹窗刷新一次再回来。</>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {selectable.map(platform => {
              const checked = selectedPlatforms.includes(platform.id)
              return (
                <button
                  key={platform.id}
                  onClick={() => togglePlatform(platform.id)}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    checked ? 'border-primary/60 bg-primary/5' : 'bg-card hover:bg-muted/50'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <PlatformIcon platformId={platform.id} icon={platform.icon} name={platform.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{platform.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {platform.username ||
                        (platform.sourceType === 'cms'
                          ? platform.homepage
                          : platform.isAuthenticated
                            ? '已登录'
                            : '未登录 · 同步前先登录')}
                    </span>
                  </span>
                  <PublishCapability platform={platform} />
                </button>
              )
            })}
          </div>
        )}
      </section>

      {isPublishMode && locked.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">
            仅支持草稿
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{locked.length} 个</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {locked.map(platform => (
              <div
                key={platform.id}
                className="flex cursor-help items-center gap-2.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5"
                onClick={() =>
                  setNotice({
                    kind: 'info',
                    text: `${platform.name} 只能存草稿：切到「存为草稿」同步，再到平台后台点发布`,
                  })
                }
              >
                <Lock className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
                <PlatformIcon platformId={platform.id} icon={platform.icon} name={platform.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-muted-foreground">{platform.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground/70">没有自动发布接口</span>
                </span>
                <PublishCapability platform={platform} />
              </div>
            ))}
          </div>
        </section>
      )}

      {unauthed.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">
            未登录
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{unauthed.length} 个</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {unauthed.map(platform => (
              <div
                key={platform.id}
                className="flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5"
              >
                <PlatformIcon platformId={platform.id} icon={platform.icon} name={platform.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-muted-foreground">{platform.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground/70">未检测到登录态</span>
                </span>
                <button className="uga-btn-ghost px-2 py-1 text-xs" onClick={() => openPlatform(platform)}>
                  <LogIn className="h-3.5 w-3.5" />
                  去登录
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export { AuthPill }

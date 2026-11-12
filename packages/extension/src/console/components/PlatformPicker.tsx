import { LogIn, Check } from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { AuthPill, PlatformIcon, PublishCapability } from './PlatformBadge'

/**
 * 平台选择器：已登录平台可勾选，未登录平台引导去登录
 */
export function PlatformPicker() {
  const { platforms, selectedPlatforms, togglePlatform, openPlatform, loadingPlatforms } = useConsoleStore()

  const authed = platforms.filter(p => p.isAuthenticated)
  const unauthed = platforms.filter(p => !p.isAuthenticated)

  if (!platforms.length) {
    return (
      <div className="uga-card p-6 text-sm text-muted-foreground">
        {loadingPlatforms ? '正在检测平台登录状态…' : '没有可用平台，请打开扩展弹窗完成初始化。'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">
            已登录平台
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{authed.length} 个</span>
          </h3>
          <div className="flex gap-1">
            <button
              className="uga-btn-ghost px-2 py-1 text-xs"
              onClick={() => useConsoleStore.getState().selectAll()}
            >
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

        {authed.length === 0 ? (
          <div className="uga-card p-5 text-sm text-muted-foreground">
            还没有检测到已登录的平台，去下面「未登录」里点开对应站点登录后再回来检测。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {authed.map(platform => {
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
                  <PlatformIcon icon={platform.icon} name={platform.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{platform.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {platform.username || (platform.sourceType === 'cms' ? platform.homepage : '已登录')}
                    </span>
                  </span>
                  <PublishCapability platform={platform} />
                </button>
              )
            })}
          </div>
        )}
      </section>

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
                <PlatformIcon icon={platform.icon} name={platform.name} />
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

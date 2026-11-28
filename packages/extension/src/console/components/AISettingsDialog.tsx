import { Sparkles, X } from 'lucide-react'
import { AIModelSettings } from './AIModelSettings'

interface Props {
  open: boolean
  onClose: () => void
  /** 从编辑器的「去设置」进来时，高亮对应模型那一栏 */
  focus?: 'text' | 'image'
}

/**
 * 控制台里的 AI 设置弹窗
 *
 * 表单本体在 AIModelSettings 里（AI 创作页也会内嵌同一份），这里只负责弹窗外壳。
 * 与扩展弹窗「设置 → 发布与智能 → AI 模型」改的是同一份 chrome.storage。
 */
export function AISettingsDialog({ open, onClose, focus }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm">
      <div className="my-6 w-full max-w-lg rounded-xl border bg-card shadow-2xl">
        <header className="flex items-center gap-2 border-b px-5 py-4">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">AI 模型</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              文本与生图分开配置，Key 只存在本机浏览器
            </p>
          </div>
          <button className="uga-btn-ghost p-1" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <AIModelSettings focus={focus} />
        </div>

        <footer className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <span className="text-[11px] text-muted-foreground">修改即保存，关闭不会丢</span>
          <button className="uga-btn-primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}

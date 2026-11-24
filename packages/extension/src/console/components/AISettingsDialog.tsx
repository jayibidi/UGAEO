import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Type,
  X,
} from 'lucide-react'
import { pickDefaultModel, type ModelCatalog } from '@ugaeo/core'
import {
  DEFAULT_AI_SETTINGS,
  getAISettings,
  maskApiKey,
  saveAISettings,
  type AISettings,
} from '../../lib/ai-settings'

interface Props {
  open: boolean
  onClose: () => void
  /** 从编辑器的「去设置」进来时，高亮对应模型那一栏 */
  focus?: 'text' | 'image'
}

type Message = { type: 'ok' | 'error'; text: string } | null

/**
 * 控制台里的 AI 设置弹窗
 *
 * 与弹窗（popup）里「设置 → 发布与智能 → AI 模型」改的是同一份 chrome.storage，
 * 只是控制台没有设置页，编辑器里点「去设置」得就地能改，否则用户要退出控制台
 * 再点扩展图标找三层菜单。
 *
 * 文本模型与生图模型分开选：中转站上这两类模型不通用，一个下拉搞不定。
 */
export function AISettingsDialog({ open, onClose, focus }: Props) {
  const [settings, setSettings] = useState<AISettings>({ ...DEFAULT_AI_SETTINGS })
  const [busy, setBusy] = useState<'library' | 'test' | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [showKey, setShowKey] = useState(false)
  const [customText, setCustomText] = useState(false)
  const [customImage, setCustomImage] = useState(false)

  useEffect(() => {
    if (!open) return
    setMessage(null)
    setBusy(null)
    getAISettings()
      .then(next => {
        setSettings(next)
        // 列表为空时直接给输入框，省一次点击
        setCustomText(next.models.length === 0)
        setCustomImage(next.imageModels.length === 0)
      })
      .catch(() => setSettings({ ...DEFAULT_AI_SETTINGS }))
  }, [open])

  const update = useCallback((patch: Partial<AISettings>) => {
    setSettings(prev => ({ ...prev, ...patch }))
    // 立即落盘：这个弹窗随时可能被关掉，攒着再存容易丢
    saveAISettings(patch).catch(() => {})
  }, [])

  const fetchLibrary = async () => {
    setBusy('library')
    setMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AI_LIST_MODEL_LIBRARY',
        payload: { baseUrl: settings.baseUrl, apiKey: settings.apiKey },
      })
      if (!response?.ok) throw new Error(response?.error || '拉取失败')
      const catalog = response.data as ModelCatalog

      const patch: Partial<AISettings> = {
        models: catalog.chat,
        imageModels: catalog.image,
      }
      if (!catalog.chat.includes(settings.model)) {
        patch.model = pickDefaultModel(catalog.chat, 'chat') || settings.model
      }
      if (!catalog.image.includes(settings.imageModel)) {
        patch.imageModel = pickDefaultModel(catalog.image, 'image') || settings.imageModel
      }
      setSettings(prev => ({ ...prev, ...patch }))
      await saveAISettings(patch)

      // 拉到了列表就切回下拉：否则用户还以为这个中转站没有模型可挑
      if (catalog.chat.length) setCustomText(false)
      if (catalog.image.length) setCustomImage(false)

      const how = catalog.metaAvailable ? '按网关能力声明分类' : '网关未给能力声明，按名称识别'
      setMessage({
        type: 'ok',
        text: `已拉取 ${catalog.total} 个模型 · 文本 ${catalog.chat.length} / 生图 ${catalog.image.length}（${how}）`,
      })
      if (catalog.image.length === 0) {
        setCustomImage(true)
      }
    } catch (error) {
      setMessage({ type: 'error', text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const testText = async () => {
    setBusy('test')
    setMessage(null)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AI_TEST',
        payload: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
      })
      if (!response?.ok) throw new Error(response?.error || '测试失败')
      setMessage({
        type: 'ok',
        text: `文本模型连通正常 · ${response.data.model} · ${response.data.latency}ms`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const ring = (active: boolean) => (active ? 'ring-1 ring-primary' : '')

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

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* 总开关 */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-sm font-medium">启用 AI 能力</p>
              <p className="text-xs text-muted-foreground">标题、摘要、标签、一键成稿与 AI 配图</p>
            </div>
            <button
              onClick={() => update({ enabled: !settings.enabled })}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                settings.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
              aria-label="启用 AI 能力"
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                  settings.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              API 地址（OpenAI 兼容）
            </label>
            <input
              className="uga-input font-mono text-xs"
              value={settings.baseUrl}
              onChange={e => update({ baseUrl: e.target.value })}
              placeholder="https://api.ugooto-ai.com/v1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              留空则使用默认中转站 https://api.ugooto-ai.com/v1
            </p>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <KeyRound className="h-3 w-3" />
              API Key
            </label>
            <div className="relative">
              <input
                className="uga-input pr-8 font-mono text-xs"
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={e => update({ apiKey: e.target.value })}
                placeholder="sk-..."
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey(v => !v)}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {settings.apiKey ? `当前 ${maskApiKey(settings.apiKey)}` : '仅保存在本机浏览器，不会上传到任何服务器'}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">模型</span>
            <button
              className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
              onClick={fetchLibrary}
              disabled={busy !== null || !settings.apiKey}
            >
              {busy === 'library' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              拉取模型库
            </button>
          </div>

          {/* 文本模型 */}
          <div className={`rounded-lg border p-3 ${ring(focus === 'text')}`}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">文本模型（排版 / 文案 / 识图）</span>
              {settings.models.length > 0 && (
                <button
                  className="ml-auto text-[11px] text-primary hover:underline"
                  onClick={() => setCustomText(v => !v)}
                >
                  {customText ? '从列表选' : '手动输入'}
                </button>
              )}
            </div>
            {customText || settings.models.length === 0 ? (
              <input
                className="uga-input font-mono text-xs"
                value={settings.model}
                onChange={e => update({ model: e.target.value })}
                placeholder="deepseek-v4.1-flash"
              />
            ) : (
              <select
                className="uga-input text-xs"
                value={settings.model}
                onChange={e => update({ model: e.target.value })}
              >
                {!settings.models.includes(settings.model) && settings.model && (
                  <option value={settings.model}>{settings.model}（自定义）</option>
                )}
                {settings.models.map(model => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              用于标题优化、摘要、标签、一键成稿与平台适配
            </p>
          </div>

          {/* 生图模型 */}
          <div className={`rounded-lg border p-3 ${ring(focus === 'image')}`}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">生图模型（AI 配图）</span>
              {settings.imageModels.length > 0 && (
                <button
                  className="ml-auto text-[11px] text-primary hover:underline"
                  onClick={() => setCustomImage(v => !v)}
                >
                  {customImage ? '从列表选' : '手动输入'}
                </button>
              )}
            </div>
            {customImage || settings.imageModels.length === 0 ? (
              <input
                className="uga-input font-mono text-xs"
                value={settings.imageModel}
                onChange={e => update({ imageModel: e.target.value })}
                placeholder="doubao-seedream-4-0-250828"
              />
            ) : (
              <select
                className="uga-input text-xs"
                value={settings.imageModel}
                onChange={e => update({ imageModel: e.target.value })}
              >
                <option value="">未选择（AI 配图不可用）</option>
                {!settings.imageModels.includes(settings.imageModel) && settings.imageModel && (
                  <option value={settings.imageModel}>{settings.imageModel}（自定义）</option>
                )}
                {settings.imageModels.map(model => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              编辑器里「AI 配图」用这个模型，走 /images/generations；不选则配图功能不可用
            </p>
          </div>

          <button
            className="w-full rounded-lg bg-muted py-2 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
            onClick={testText}
            disabled={busy !== null || !settings.apiKey || !settings.model}
          >
            {busy === 'test' ? '测试中…' : '测试文本模型连接'}
          </button>

          {message && (
            <div
              className={`flex items-start gap-1.5 rounded p-2 text-[11px] ${
                message.type === 'ok'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
              }`}
            >
              {message.type === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              )}
              <span className="leading-relaxed">{message.text}</span>
            </div>
          )}
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

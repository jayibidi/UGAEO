import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Github, Globe, MessageSquare, ExternalLink } from 'lucide-react'

export function AboutPage() {
  const navigate = useNavigate()
  const version = chrome.runtime.getManifest().version

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold">关于</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        {/* Logo & Title */}
        <img src="/assets/icon-128.png" alt="Logo" className="w-16 h-16 mb-3" />
        <h2 className="text-lg font-semibold">UG·AEO</h2>
        <p className="text-sm text-muted-foreground mt-1">v{version}</p>

        {/* Description */}
        <p className="text-sm text-muted-foreground text-center mt-4 leading-relaxed">
          一键将文章同步到多个平台
        </p>

        {/* Links */}
        <div className="flex flex-col gap-2 mt-6 w-full max-w-[240px]">
          <a
            href="https://api.ugooto-ai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <Github className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">UGooTo</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
          <a
            href="https://api.ugooto-ai.com/console"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <Globe className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">控制台</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
          <a
            href="https://api.ugooto-ai.com/console"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">问题反馈</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground mt-6">
          如果觉得不错，请分享给你的朋友 ✌️
        </p>
      </div>
    </div>
  )
}

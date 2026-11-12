import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewPage } from './pages/Overview'
import { SyncPage } from './pages/Sync'
import { AccountsPage } from './pages/Accounts'
import { HistoryPage } from './pages/History'
import { FailuresPage } from './pages/Failures'
import { DiagnosticsPage } from './pages/Diagnostics'
import { bindConsoleProgressListener, bindHandoffListener, useConsoleStore } from './lib/store'

export default function ConsoleApp() {
  const boot = useConsoleStore(state => state.boot)
  const refreshHistory = useConsoleStore(state => state.refreshHistory)

  useEffect(() => {
    bindConsoleProgressListener()
    bindHandoffListener()
    boot().catch(() => {})
  }, [boot])

  // 后台可能在别的标签页完成同步，定期刷新记录
  useEffect(() => {
    const timer = setInterval(() => {
      refreshHistory().catch(() => {})
    }, 20000)
    return () => clearInterval(timer)
  }, [refreshHistory])

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/failures" element={<FailuresPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}

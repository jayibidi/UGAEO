import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SyncDialogPage } from './SyncDialogPage'
import '../popup/styles/globals.css'
import { installRejectionGuard } from '../lib/rejection-guard'

installRejectionGuard('SyncDialog')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SyncDialogPage />
  </StrictMode>
)

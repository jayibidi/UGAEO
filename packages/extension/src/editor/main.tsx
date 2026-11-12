import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'
import '../popup/styles/globals.css'
import { installRejectionGuard } from '../lib/rejection-guard'

installRejectionGuard('Editor')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>
)

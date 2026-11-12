import React from 'react'
import ReactDOM from 'react-dom/client'
import ConsoleApp from './ConsoleApp'
import './styles.css'
import { installRejectionGuard } from '../lib/rejection-guard'

installRejectionGuard('Console')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConsoleApp />
  </React.StrictMode>
)

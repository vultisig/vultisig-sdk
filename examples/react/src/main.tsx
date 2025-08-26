import './index.css'

import { Buffer } from 'buffer'
import process from 'process'
import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Ensure Buffer and process are available globally for browserified deps
if (!('Buffer' in window)) {
  // @ts-expect-error
  window.Buffer = Buffer
}
if (!('process' in window)) {
  // @ts-expect-error
  window.process = process as unknown as Process
}

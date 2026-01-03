import './styles.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'

// Initialize SDK before rendering
async function bootstrap() {
  try {
    // SDK is already initialized in the main process
    // Just verify it's ready
    await window.electronAPI.initialize()

    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  } catch (error) {
    console.error('Failed to initialize:', error)
    document.getElementById('root')!.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Initialization Error</h1>
        <p>Failed to connect to Vultisig SDK: ${error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    `
  }
}

bootstrap()

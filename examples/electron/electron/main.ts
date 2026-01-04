import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

import { registerIpcHandlers } from './ipc-handlers'
import { disposeSDK, initializeSDK } from './sdk'

let mainWindow: BrowserWindow | null = null

const createWindow = async () => {
  // Initialize SDK before creating window
  console.log('Initializing Vultisig SDK...')
  try {
    await initializeSDK()
    console.log('SDK initialized successfully')
  } catch (error) {
    console.error('Failed to initialize SDK:', error)
    // Continue anyway - we'll show an error in the UI
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // CRITICAL: Disabled for security
      contextIsolation: true, // CRITICAL: Enabled for security
      sandbox: true, // Additional sandboxing
    },
  })

  // Register all IPC handlers
  registerIpcHandlers(ipcMain)

  // Load renderer
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    // Development: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Production: load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  disposeSDK()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

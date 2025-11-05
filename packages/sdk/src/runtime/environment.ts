/**
 * Detected runtime environment types.
 */
export type Environment =
  | 'browser' // Standard browser
  | 'node' // Node.js
  | 'electron-main' // Electron main process
  | 'electron-renderer' // Electron renderer process
  | 'chrome-extension' // Chrome extension (popup/options/content script)
  | 'chrome-extension-sw' // Chrome extension service worker (background)
  | 'worker' // Web Worker / Service Worker
  | 'unknown' // Unsupported

/**
 * Detect the current runtime environment.
 *
 * Detection Order (order matters!):
 * 1. Electron (has both process and window)
 * 2. Chrome Extension (has chrome.runtime API)
 * 3. Web Worker / Service Worker
 * 4. Browser (has window and document)
 * 5. Node.js (has process and no window)
 */
export function detectEnvironment(): Environment {
  // Check for Electron FIRST (must be before browser check)
  // Electron has both process and window, so we need to check for process.versions.electron
  if (
    typeof process !== 'undefined' &&
    process.versions?.electron
  ) {
    // Main process has type 'browser', renderer has type 'renderer'
    const processType = (process as any).type
    if (processType === 'browser') return 'electron-main'
    if (processType === 'renderer') return 'electron-renderer'
    // Fallback if type is not set (shouldn't happen, but be safe)
    return typeof window !== 'undefined' ? 'electron-renderer' : 'electron-main'
  }

  // Check for Chrome Extension (must be before browser/worker check)
  // Chrome extensions have the chrome.runtime API
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.id
  ) {
    // Service worker context (background script)
    // @ts-ignore - ServiceWorkerGlobalScope type conflict between dom and webworker libs
    if (
      // @ts-ignore - ServiceWorkerGlobalScope type conflict between dom and webworker libs
      typeof ServiceWorkerGlobalScope !== 'undefined' &&
      typeof self !== 'undefined' &&
      // @ts-ignore - ServiceWorkerGlobalScope type conflict between dom and webworker libs
      self instanceof ServiceWorkerGlobalScope
    ) {
      return 'chrome-extension-sw'
    }

    // Extension page context (popup, options, content script)
    return 'chrome-extension'
  }

  // Check for Web Workers / Service Workers
  if (
    typeof self !== 'undefined' &&
    typeof (globalThis as any).WorkerGlobalScope !== 'undefined' &&
    self instanceof (globalThis as any).WorkerGlobalScope
  ) {
    return 'worker'
  }

  // Check for browser (has window and document)
  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  ) {
    return 'browser'
  }

  // Check for Node.js (has process and Node version, but no window)
  if (
    typeof process !== 'undefined' &&
    process.versions?.node
  ) {
    return 'node'
  }

  return 'unknown'
}

/**
 * Check if running in a browser environment.
 * Includes Electron renderer (has browser APIs).
 */
export function isBrowser(): boolean {
  const env = detectEnvironment()
  return env === 'browser' || env === 'electron-renderer'
}

/**
 * Check if running in a Node.js environment.
 * Includes Electron main process (has Node.js APIs).
 */
export function isNode(): boolean {
  const env = detectEnvironment()
  return env === 'node' || env === 'electron-main'
}

/**
 * Check if running in Electron (any process).
 */
export function isElectron(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.versions?.electron
  )
}

/**
 * Check if running in Electron main process.
 */
export function isElectronMain(): boolean {
  return detectEnvironment() === 'electron-main'
}

/**
 * Check if running in Electron renderer process.
 */
export function isElectronRenderer(): boolean {
  return detectEnvironment() === 'electron-renderer'
}

/**
 * Check if running in a Web Worker or Service Worker.
 */
export function isWorker(): boolean {
  return detectEnvironment() === 'worker'
}

/**
 * Check if running in a Chrome extension (any context).
 */
export function isChromeExtension(): boolean {
  const env = detectEnvironment()
  return env === 'chrome-extension' || env === 'chrome-extension-sw'
}

/**
 * Check if running in a Chrome extension service worker (background script).
 */
export function isChromeExtensionServiceWorker(): boolean {
  return detectEnvironment() === 'chrome-extension-sw'
}

/**
 * Check if running in a Chrome extension page (popup, options, content script).
 */
export function isChromeExtensionPage(): boolean {
  return detectEnvironment() === 'chrome-extension'
}

/**
 * Get environment information for debugging.
 */
export function getEnvironmentInfo(): {
  environment: Environment
  hasWindow: boolean
  hasDocument: boolean
  hasProcess: boolean
  hasNavigator: boolean
  isElectron: boolean
  isChromeExtension: boolean
  nodeVersion?: string
  electronVersion?: string
  chromeExtensionId?: string
  userAgent?: string
} {
  const env = detectEnvironment()

  return {
    environment: env,
    hasWindow: typeof window !== 'undefined',
    hasDocument: typeof document !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasNavigator: typeof navigator !== 'undefined',
    isElectron: isElectron(),
    isChromeExtension: isChromeExtension(),
    nodeVersion: typeof process !== 'undefined' ? process.versions?.node : undefined,
    electronVersion: typeof process !== 'undefined' ? process.versions?.electron : undefined,
    chromeExtensionId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  }
}

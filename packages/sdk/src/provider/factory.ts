import { detectEnvironment } from './environment'
import { BrowserProvider } from './BrowserProvider'
import { NodeProvider } from './NodeProvider'
import { ElectronProvider } from './ElectronProvider'
import type { ProviderConfig, VultisigProvider } from './types'

/**
 * Create a provider with automatic environment detection.
 *
 * This is the recommended way to create a provider.
 * The correct implementation will be selected based on the runtime environment:
 * - Browser → BrowserProvider (IndexedDB/localStorage)
 * - Node.js → NodeProvider (filesystem)
 * - Electron → ElectronProvider (auto-detects main/renderer)
 *
 * @param config - Optional provider configuration
 * @returns Provider instance appropriate for the current environment
 * @throws Error if environment is not supported
 *
 * @example
 * ```typescript
 * // Auto-detect environment
 * const provider = createProvider()
 * await provider.connect()
 *
 * // With configuration
 * const provider = createProvider({
 *   autoInit: true,
 *   defaultChains: ['Ethereum', 'Bitcoin'],
 * })
 * ```
 */
export function createProvider(
  config: ProviderConfig = {}
): VultisigProvider {
  const env = detectEnvironment()

  switch (env) {
    case 'browser':
      return new BrowserProvider(config)

    case 'node':
      return new NodeProvider(config)

    case 'electron-main':
    case 'electron-renderer':
      return new ElectronProvider(config)

    case 'worker':
      // Web Workers can use BrowserProvider (with in-memory fallback)
      console.warn('Running in Web Worker - using in-memory storage')
      return new BrowserProvider(config)

    default:
      throw new Error(
        `Unsupported environment: ${env}. ` +
        `Provider supports browser, Node.js, Electron, and Web Workers.`
      )
  }
}

/**
 * Create a browser provider explicitly.
 * Use this when you want to force browser provider regardless of environment.
 *
 * @param config - Optional provider configuration
 * @returns BrowserProvider instance
 */
export function createBrowserProvider(
  config?: ProviderConfig
): BrowserProvider {
  return new BrowserProvider(config)
}

/**
 * Create a Node.js provider explicitly.
 * Use this when you want to force Node provider regardless of environment.
 *
 * @param config - Optional provider configuration
 * @returns NodeProvider instance
 */
export function createNodeProvider(
  config?: ProviderConfig
): NodeProvider {
  return new NodeProvider(config)
}

/**
 * Create an Electron provider explicitly.
 * Use this when you want to force Electron provider regardless of environment.
 *
 * @param config - Optional provider configuration
 * @returns ElectronProvider instance
 */
export function createElectronProvider(
  config?: ProviderConfig
): ElectronProvider {
  return new ElectronProvider(config)
}

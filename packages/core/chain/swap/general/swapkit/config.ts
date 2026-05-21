export type SwapKitConfig = {
  apiKey?: string
  baseUrl: string
}

/**
 * Vultisig-proxy URLs per platform (paaao 2026-05-21).
 * The proxy injects the SwapKit API key server-side — NO client-side key needed.
 *
 * iOS / macOS  → https://api.vultisig.com/swapkit/
 * Android      → https://api.vultisig.com/swapkit-a/
 * Windows/ext  → https://api.vultisig.com/swapkit-win/  (default fallback)
 *
 * Callers may override via configureSwapKit({ baseUrl }) or
 * env var SWAPKIT_BASE_URL / VULTISIG_SWAPKIT_BASE_URL.
 */
const detectDefaultBaseUrl = (): string => {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined>; platform?: string }
  }

  const platform = maybeGlobal.process?.platform as string | undefined

  // 'darwin' = Node.js on macOS; 'ios' = React Native iOS; 'macos' = React Native macOS / Mac Catalyst
  if (platform === 'darwin' || platform === 'ios' || platform === 'macos') {
    return 'https://api.vultisig.com/swapkit'
  }

  if (platform === 'android') {
    return 'https://api.vultisig.com/swapkit-a'
  }

  // Windows, extension (electron/chromium), and unknown platforms
  return 'https://api.vultisig.com/swapkit-win'
}

const readEnv = (key: string): string | undefined => {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return maybeGlobal.process?.env?.[key]
}

let swapKitConfig: SwapKitConfig = {
  baseUrl: detectDefaultBaseUrl(),
}

export const configureSwapKit = (config: Partial<SwapKitConfig>) => {
  swapKitConfig = {
    ...swapKitConfig,
    ...(Object.prototype.hasOwnProperty.call(config, 'apiKey') ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  }
}

export const getSwapKitConfig = (): SwapKitConfig => {
  const apiKey = swapKitConfig.apiKey ?? readEnv('SWAPKIT_API_KEY') ?? readEnv('VULTISIG_SWAPKIT_API_KEY')
  const baseUrl = readEnv('SWAPKIT_BASE_URL') ?? readEnv('VULTISIG_SWAPKIT_BASE_URL') ?? swapKitConfig.baseUrl

  return {
    ...swapKitConfig,
    baseUrl,
    apiKey,
  }
}

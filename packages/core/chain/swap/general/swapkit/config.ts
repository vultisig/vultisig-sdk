export type SwapKitConfig = {
  apiKey?: string
  baseUrl: string
}

const defaultSwapKitBaseUrl = 'https://api.vultisig.com/swapkit-win'

const readEnv = (key: string): string | undefined => {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return maybeGlobal.process?.env?.[key]
}

let swapKitConfig: SwapKitConfig = {
  baseUrl: defaultSwapKitBaseUrl,
}

export const configureSwapKit = (config: Partial<SwapKitConfig>) => {
  swapKitConfig = {
    ...swapKitConfig,
    ...config,
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

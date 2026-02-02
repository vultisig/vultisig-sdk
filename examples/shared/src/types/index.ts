// Shared types for both browser and electron examples

// ===== Seedphrase Import Types =====

/** Result of seedphrase validation */
export type SeedphraseValidation = {
  valid: boolean
  wordCount: number
  invalidWords?: string[]
  error?: string
}

/** Chain discovery progress phases */
export type ChainDiscoveryPhase = 'validating' | 'deriving' | 'fetching' | 'complete'

/** Progress update during chain discovery */
export type ChainDiscoveryProgress = {
  phase: ChainDiscoveryPhase
  chain?: string
  chainsProcessed: number
  chainsTotal: number
  chainsWithBalance: string[]
  message: string
}

/** Result for a single chain during discovery */
export type ChainDiscoveryResult = {
  chain: string
  address: string
  balance: string
  decimals: number
  symbol: string
  hasBalance: boolean
}

/** Options for creating FastVault from seedphrase */
export type CreateFastVaultFromSeedphraseOptions = {
  mnemonic: string
  name: string
  password: string
  email: string
  discoverChains?: boolean
  chains?: string[]
  onProgress?: (step: ProgressStep) => void
  onChainDiscovery?: (progress: ChainDiscoveryProgress) => void
}

/** Options for creating SecureVault from seedphrase */
export type CreateSecureVaultFromSeedphraseOptions = {
  mnemonic: string
  name: string
  password?: string
  devices: number
  threshold?: number
  discoverChains?: boolean
  chains?: string[]
  onProgress?: (step: ProgressStep) => void
  onQRCodeReady?: (qrPayload: string) => void
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  onChainDiscovery?: (progress: ChainDiscoveryProgress) => void
}

/** Options for joining an existing SecureVault session */
export type JoinSecureVaultOptions = {
  mnemonic?: string // Required for seedphrase-based, ignored for keygen
  password?: string
  devices?: number
  onProgress?: (step: ProgressStep) => void
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
}

/** Result of joining a SecureVault session */
export type JoinSecureVaultResult = {
  vault: VaultInfo
  vaultId: string
}

/** @deprecated Use CreateFastVaultFromSeedphraseOptions instead */
export type ImportSeedphraseFastOptions = CreateFastVaultFromSeedphraseOptions

/** @deprecated Use CreateSecureVaultFromSeedphraseOptions instead */
export type ImportSeedphraseSecureOptions = CreateSecureVaultFromSeedphraseOptions

// ===== Vault Types =====

export type VaultInfo = {
  id: string
  name: string
  type: 'fast' | 'secure'
  chains: string[]
  threshold?: number
  signerCount?: number
}

export type BalanceInfo = {
  raw: string
  formatted: string
  decimals: number
}

export type ProgressStep = {
  message: string
  progress: number
  phase?: string
}

export type EventType =
  | 'info'
  | 'success'
  | 'error'
  | 'warning'
  | 'vault'
  | 'balance'
  | 'transaction'
  | 'signing'
  | 'chain'

export type EventLogEntry = {
  id: string
  type: EventType
  source: 'sdk' | 'vault' | 'ipc' | 'ui'
  message: string
  timestamp: Date
  data?: unknown
}

export type DeviceJoinedData = {
  deviceId: string
  totalJoined: number
  required: number
}

// Vault creation options
export type CreateFastVaultOptions = {
  name: string
  password: string
  email: string
  onProgress?: (step: ProgressStep) => void
}

export type CreateSecureVaultOptions = {
  name: string
  password?: string
  devices: number
  threshold?: number
  onProgress?: (step: ProgressStep) => void
  onQRCodeReady?: (qrPayload: string) => void
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
}

export type CreateSecureVaultResult = {
  vault: VaultInfo
  sessionId: string
}

// Transaction types
export type CoinInfo = {
  chain: string
  address: string
  decimals: number
  ticker: string
  id?: string
}

export type SendTxParams = {
  coin: CoinInfo
  receiver: string
  amount: string | bigint
  memo?: string
}

export type BroadcastParams = {
  chain: string
  keysignPayload: unknown
  signature: unknown
}

export type ExportOptions = {
  password?: string
  includeSigners?: boolean
}

// File adapter types
export type SelectFilesOptions = {
  title?: string
  filters?: Array<{ name: string; extensions: string[] }>
  multiple?: boolean
}

export type SelectedFile = {
  name: string
  path?: string // Only available in Electron
  file?: File // Only available in Browser
}

export type SelectFilesResult = {
  canceled: boolean
  files: SelectedFile[]
}

export type SaveFileOptions = {
  title?: string
  defaultName?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

// Token type
export type TokenInfo = {
  id: string
  symbol: string
  name: string
  decimals: number
  contractAddress?: string
  chainId?: string
}

// Balance type
export type BalanceResult = {
  amount: string
  decimals: number
  symbol?: string
  value?: number
}

// Fiat currency type
export type FiatCurrency = 'usd' | 'eur' | 'gbp' | 'jpy' | 'cny' | 'aud' | 'cad' | 'chf' | 'sgd' | 'sek'

// Discount tier type (based on VULT token + Thorguard NFT holdings)
export type DiscountTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'ultimate' | null

// Value result (for portfolio)
export type ValueResult = {
  amount: string
  currency: FiatCurrency
}

// Swap quote result
export type SwapQuoteResult = {
  estimatedOutput: string
  estimatedOutputFiat?: number
  fees: {
    total: string
    network?: string
    protocol?: string
  }
  feesFiat?: {
    total?: number
    network?: number
    protocol?: number
  }
  provider?: string
  route?: unknown
}

// Swap params
export type GetSwapQuoteParams = {
  fromCoin: CoinInfo
  toCoin: CoinInfo
  amount: number
  fiatCurrency?: FiatCurrency
}

export type PrepareSwapParams = {
  fromCoin: CoinInfo
  toCoin: CoinInfo
  amount: number
  swapQuote: SwapQuoteResult
  autoApprove?: boolean
}

export type SwapResult = {
  keysignPayload: unknown
  approvalPayload?: unknown
}

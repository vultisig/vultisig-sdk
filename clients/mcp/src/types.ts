export type Balance = {
  chain: string
  amount: string
  symbol?: string
  fiatValue?: number
  [key: string]: unknown
}

export type Portfolio = {
  balances: Balance[]
  totalValue: string
  currency: string
}

export type SendResult = {
  dryRun: boolean
  fee?: string
  total?: string
  txHash?: string
  chain?: string
  [key: string]: unknown
}

export type SwapResult = {
  dryRun: boolean
  quote?: unknown
  txHash?: string
  chain?: string
  [key: string]: unknown
}

export type Signer = {
  id: string
  publicKey: string
  name: string
}

export type Vault = {
  name: string
  type: 'fast' | 'secure'
  chains: string[]
  signers: Signer[]
  localPartyId: string
  threshold: number
  createdAt: number
  allBalances(includeTokens?: boolean): Promise<Balance[]>
  portfolio(fiatCurrency?: string): Promise<Portfolio>
  address(chain: string): Promise<string>
  getSupportedSwapChains(): readonly string[]
  send(params: {
    chain: string
    to: string
    amount: string
    symbol?: string
    memo?: string
    dryRun?: boolean
  }): Promise<SendResult>
  swap(params: {
    fromChain: string
    fromSymbol?: string
    toChain: string
    toSymbol?: string
    amount: string
    dryRun?: boolean
  }): Promise<SwapResult>
  sign?(params: { transaction: unknown; chain: string }): Promise<unknown>
  broadcastTx?(params: { chain: string; keysignPayload: unknown; signature: unknown }): Promise<string>
}

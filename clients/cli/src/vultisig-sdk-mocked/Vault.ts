import type {
  Summary,
  Balance,
  SigningPayload,
  Signature,
  Token,
  Value,
  GasInfo,
  GasEstimate,
  VaultType,
  SigningStep
} from './types'

export class Vault {
  private _summary: Summary
  private addressCache: Record<string, string> = {}
  private balanceCache: Record<string, Balance> = {}
  private valueCache: Record<string, Value> = {}
  private tokenCache: Record<string, Token[]> = {}

  constructor(summary: Summary) {
    this._summary = summary
    
    // Initialize with default tokens for common chains
    this.initializeDefaultTokens()
  }

  // === CORE PROPERTIES ===
  summary(): Summary {
    return { ...this._summary }
  }

  // === VAULT OPERATIONS ===
  async export(password?: string): Promise<Blob> {
    const vaultData = {
      ...this._summary,
      exportedAt: Date.now(),
      encrypted: !!password
    }
    
    return new Blob([JSON.stringify(vaultData, null, 2)], { 
      type: 'application/json' 
    })
  }

  async delete(): Promise<void> {
    // Mock: remove from storage
    console.log(`🗑️ Deleted vault: ${this._summary.name}`)
  }

  async rename(newName: string): Promise<void> {
    this._summary.name = newName
    this._summary.lastModified = Date.now()
    console.log(`📝 Renamed vault to: ${newName}`)
  }

  // === CHAIN MANAGEMENT ===
  setChains(chains: string[]): void {
    this._summary.chains = [...chains]
    this._summary.lastModified = Date.now()
  }

  addChain(chain: string): void {
    if (!this._summary.chains.includes(chain)) {
      this._summary.chains.push(chain)
      this._summary.lastModified = Date.now()
    }
  }

  removeChain(chain: string): void {
    this._summary.chains = this._summary.chains.filter(c => c !== chain)
    delete this.addressCache[chain]
    delete this.balanceCache[chain]
    delete this.valueCache[chain]
    delete this.tokenCache[chain]
    this._summary.lastModified = Date.now()
  }

  chains(): string[] {
    return [...this._summary.chains]
  }

  // === ADDRESS MANAGEMENT ===
  async address(chain: string): Promise<string> {
    if (this.addressCache[chain]) {
      return this.addressCache[chain]
    }

    // Mock address generation
    let address: string
    switch (chain.toLowerCase()) {
      case 'bitcoin':
        address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
        break
      case 'ethereum':
        address = '0x742d35Cc6634C0532925a3b8D8D5d8D0c8b4c8D5'
        break
      case 'solana':
        address = 'G5Jm9gkT8bZ2kZ3qF7vX8nP9cR5wH4jL2mN6oQ1sU3v'
        break
      case 'litecoin':
        address = 'ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
        break
      case 'dogecoin':
        address = 'DQxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
        break
      default:
        address = `${chain}_${this._summary.id.slice(0, 8)}_mock`
    }

    this.addressCache[chain] = address
    return address
  }

  async addresses(chains?: string[]): Promise<Record<string, string>> {
    const targetChains = chains || this._summary.chains
    const addresses: Record<string, string> = {}

    for (const chain of targetChains) {
      addresses[chain] = await this.address(chain)
    }

    return addresses
  }

  // === TOKEN MANAGEMENT ===
  setTokens(chain: string, tokens: Token[]): void {
    this.tokenCache[chain] = [...tokens]
    this._summary.tokens[chain] = [...tokens]
    this._summary.lastModified = Date.now()
  }

  addToken(chain: string, token: Token): void {
    if (!this.tokenCache[chain]) {
      this.tokenCache[chain] = []
      this._summary.tokens[chain] = []
    }
    
    const exists = this.tokenCache[chain].some(t => t.id === token.id)
    if (!exists) {
      this.tokenCache[chain].push(token)
      this._summary.tokens[chain].push(token)
      this._summary.lastModified = Date.now()
    }
  }

  removeToken(chain: string, tokenId: string): void {
    if (this.tokenCache[chain]) {
      this.tokenCache[chain] = this.tokenCache[chain].filter(t => t.id !== tokenId)
      this._summary.tokens[chain] = this.tokenCache[chain]
      delete this.balanceCache[`${chain}:${tokenId}`]
      delete this.valueCache[`${chain}:${tokenId}`]
      this._summary.lastModified = Date.now()
    }
  }

  getTokens(chain: string): Token[] {
    return this.tokenCache[chain] || []
  }

  // === BALANCE MANAGEMENT ===
  async balance(chain: string, tokenId?: string): Promise<Balance> {
    const key = tokenId ? `${chain}:${tokenId}` : chain
    
    if (this.balanceCache[key]) {
      return this.balanceCache[key]
    }

    // Mock balance generation
    const balance: Balance = {
      amount: (Math.random() * 10).toFixed(6),
      symbol: tokenId ? this.getTokenSymbol(chain, tokenId) : this.getChainSymbol(chain),
      decimals: 18,
      chainId: chain,
      tokenId
    }

    this.balanceCache[key] = balance
    return balance
  }

  async balances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Balance>> {
    const targetChains = chains || this._summary.chains
    const balances: Record<string, Balance> = {}

    for (const chain of targetChains) {
      // Native balance
      balances[chain] = await this.balance(chain)

      // Token balances
      if (includeTokens) {
        const tokens = this.getTokens(chain)
        for (const token of tokens) {
          const key = `${chain}:${token.id}`
          balances[key] = await this.balance(chain, token.id)
        }
      }
    }

    return balances
  }

  async updateBalance(chain: string, tokenId?: string): Promise<Balance> {
    const key = tokenId ? `${chain}:${tokenId}` : chain
    delete this.balanceCache[key]
    return this.balance(chain, tokenId)
  }

  async updateBalances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Record<string, Balance>>> {
    const targetChains = chains || this._summary.chains
    const result: Record<string, Record<string, Balance>> = {}

    for (const chain of targetChains) {
      result[chain] = {}
      
      // Clear cache for this chain
      Object.keys(this.balanceCache).forEach(key => {
        if (key.startsWith(chain)) {
          delete this.balanceCache[key]
        }
      })

      // Native balance
      result[chain][chain] = await this.balance(chain)

      // Token balances
      if (includeTokens) {
        const tokens = this.getTokens(chain)
        for (const token of tokens) {
          result[chain][token.id] = await this.balance(chain, token.id)
        }
      }
    }

    return result
  }

  // === FIAT VALUE OPERATIONS ===
  setCurrency(currency: string): Promise<void> {
    this._summary.currency = currency
    this._summary.lastModified = Date.now()
    // Clear value cache when currency changes
    this.valueCache = {}
    return Promise.resolve()
  }

  getCurrency(): string {
    return this._summary.currency
  }

  async getValue(chain: string, tokenId?: string): Promise<Value> {
    const key = tokenId ? `${chain}:${tokenId}` : chain
    
    if (this.valueCache[key]) {
      return this.valueCache[key]
    }

    const balance = await this.balance(chain, tokenId)
    const mockRate = Math.random() * 50000 + 100 // Mock price between $100-$50,100

    const value: Value = {
      amount: (parseFloat(balance.amount) * mockRate).toFixed(2),
      currency: this._summary.currency,
      symbol: this.getCurrencySymbol(this._summary.currency),
      rate: mockRate,
      lastUpdated: Date.now()
    }

    this.valueCache[key] = value
    return value
  }

  async getValues(chain: string): Promise<Record<string, Value>> {
    const values: Record<string, Value> = {}
    
    // Native token value
    values[chain] = await this.getValue(chain)

    // Token values
    const tokens = this.getTokens(chain)
    for (const token of tokens) {
      values[token.id] = await this.getValue(chain, token.id)
    }

    return values
  }

  async updateValues(chain: string | 'all'): Promise<void> {
    if (chain === 'all') {
      this.valueCache = {}
      return
    }

    // Clear values for specific chain
    Object.keys(this.valueCache).forEach(key => {
      if (key.startsWith(chain)) {
        delete this.valueCache[key]
      }
    })
  }

  async getTotalValue(): Promise<Value> {
    let totalValue = 0
    const currency = this._summary.currency

    // Sum all chain values
    for (const chain of this._summary.chains) {
      const chainValue = await this.getValue(chain)
      totalValue += parseFloat(chainValue.amount)

      // Add token values
      const tokens = this.getTokens(chain)
      for (const token of tokens) {
        const tokenValue = await this.getValue(chain, token.id)
        totalValue += parseFloat(tokenValue.amount)
      }
    }

    return {
      amount: totalValue.toFixed(2),
      currency,
      symbol: this.getCurrencySymbol(currency),
      rate: 1, // Total value doesn't have a single rate
      lastUpdated: Date.now()
    }
  }

  async updateTotalValue(): Promise<Value> {
    // Clear all value caches to force recalculation
    this.valueCache = {}
    return this.getTotalValue()
  }

  get lastValueUpdate(): Date | undefined {
    const values = Object.values(this.valueCache)
    if (values.length === 0) return undefined
    
    const latestUpdate = Math.max(...values.map(v => v.lastUpdated))
    return new Date(latestUpdate)
  }

  // === SIGNING OPERATIONS ===
  async sign(payload: SigningPayload): Promise<Signature> {
    // Mock signing with progress updates
    if (payload.onProgress) {
      const steps: SigningStep[] = [
        { step: 'preparing', progress: 20, message: 'Preparing transaction', mode: payload.signingMode || 'relay' },
        { step: 'coordinating', progress: 40, message: 'Coordinating with signers', mode: payload.signingMode || 'relay', participantCount: this._summary.totalSigners, participantsReady: 1 },
        { step: 'signing', progress: 70, message: 'Generating signature', mode: payload.signingMode || 'relay', participantCount: this._summary.totalSigners, participantsReady: this._summary.threshold },
        { step: 'broadcasting', progress: 90, message: 'Broadcasting transaction', mode: payload.signingMode || 'relay' },
        { step: 'complete', progress: 100, message: 'Transaction completed', mode: payload.signingMode || 'relay' }
      ]

      for (const step of steps) {
        payload.onProgress(step)
        await new Promise(resolve => setTimeout(resolve, 500)) // Mock delay
      }
    }

    // Generate mock signature
    const mockSignature = '0x' + Array(128).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
    const mockTxHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')

    return {
      signature: mockSignature,
      txHash: mockTxHash
    }
  }

  // === GAS ESTIMATION ===
  async gas(chain: string): Promise<GasInfo> {
    return {
      chainId: chain,
      gasPrice: '20000000000', // 20 gwei
      gasPriceGwei: '20',
      priorityFee: '2000000000', // 2 gwei
      maxFeePerGas: '30000000000', // 30 gwei
      lastUpdated: Date.now()
    }
  }

  async estimateGas(params: any): Promise<GasEstimate> {
    return {
      gasLimit: 21000,
      gasPrice: '20000000000',
      totalCost: {
        baseToken: '0.00042 ETH',
        usd: '1.25',
        symbol: '$'
      },
      breakdown: {
        gasLimit: 21000,
        gasPrice: '20000000000',
        priorityFee: '2000000000',
        maxFeePerGas: '30000000000'
      },
      chainId: params.chain || 'ethereum'
    }
  }

  // === EMAIL VERIFICATION (Fast Vaults) ===
  async verifyEmail(code: string): Promise<boolean> {
    // Mock verification - accept any 4-6 digit code
    const isValid = /^\d{4,6}$/.test(code)
    if (isValid) {
      console.log(`✅ Email verified with code: ${code}`)
    }
    return isValid
  }

  async resendVerificationEmail(): Promise<void> {
    console.log('📧 Verification email resent')
  }

  // === VAULT OPERATIONS ===
  async reshare(options: { newParticipants: string[], removeParticipants?: string[] }): Promise<Vault> {
    // Mock reshare - create new vault with updated participants
    const newSummary = { ...this._summary }
    
    // Update signers (simplified)
    const newSigners = this._summary.signers.filter(s => 
      !options.removeParticipants?.includes(s.id)
    )
    
    options.newParticipants.forEach((participant, index) => {
      newSigners.push({
        id: participant,
        publicKey: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        name: `Participant ${index + 1}`
      })
    })

    newSummary.signers = newSigners
    newSummary.totalSigners = newSigners.length
    newSummary.lastModified = Date.now()

    return new Vault(newSummary)
  }

  // === HELPER METHODS ===
  private initializeDefaultTokens(): void {
    // Add popular tokens for supported chains
    if (this._summary.chains.includes('ethereum')) {
      this.setTokens('ethereum', [
        {
          id: 'usdc',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          contractAddress: '0xA0b86a33E6441C8C4E5C0a3d78B7E1c4d2d2D8F3',
          chainId: 'ethereum',
          logoUrl: 'https://example.com/usdc.png'
        },
        {
          id: 'usdt',
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 6,
          contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          chainId: 'ethereum',
          logoUrl: 'https://example.com/usdt.png'
        }
      ])
    }
  }

  private getChainSymbol(chain: string): string {
    const symbols: Record<string, string> = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'solana': 'SOL',
      'litecoin': 'LTC',
      'dogecoin': 'DOGE'
    }
    return symbols[chain.toLowerCase()] || chain.toUpperCase()
  }

  private getTokenSymbol(chain: string, tokenId: string): string {
    const tokens = this.getTokens(chain)
    const token = tokens.find(t => t.id === tokenId)
    return token?.symbol || tokenId.toUpperCase()
  }

  private getCurrencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥'
    }
    return symbols[currency.toUpperCase()] || currency
  }
}

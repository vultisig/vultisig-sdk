export const jupiterSwapConfig = {
  baseUrl: 'https://api.vultisig.com/jup',
  defaultSlippageBps: 50,
  feeOwner: '8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z',
} as const

export type JupiterAffiliateConfig = {
  feeOwner: string
  baseUrl?: string
}

export type JupiterSwapConfig = {
  baseUrl: string
  defaultSlippageBps: number
  feeOwner: string
}

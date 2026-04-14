// Shared tool descriptions — single source of truth for CLI help text and MCP tool metadata.
// Both transports compose these at their call site; this file is just the copy.

export const balance = {
  description: 'Show balance for a chain or all chains',
  params: {
    chain: 'Filter by chain name (e.g. Ethereum, Bitcoin)',
    includeTokens: 'Include ERC-20/SPL token balances',
  },
} as const

export const portfolio = {
  description: 'Show total portfolio value with fiat (USD) valuations',
  params: {
    chain: 'Filter by chain name',
    currency: 'Fiat currency (usd, eur, gbp, etc.)',
  },
} as const

export const address = {
  description: 'Show the wallet address for a specific chain',
  params: {
    chain: 'Chain name (e.g. Ethereum, Bitcoin)',
  },
} as const

export const vaultInfo = {
  description: 'Show vault metadata — name, type, chains, and signer configuration. Call this first to discover available chains.',
  params: {},
} as const

export const supportedChains = {
  description: 'List chains that support swaps (not all vault chains support swaps)',
  params: {},
} as const

export const swapQuote = {
  description: 'Get a swap quote without executing — shows estimated output, fees, and provider',
  params: {
    from: 'Source chain or chain:token (e.g. Ethereum or Ethereum:USDC)',
    to: 'Destination chain or chain:token',
    amount: 'Amount to swap in human-readable units (e.g. "0.1")',
  },
} as const

export const swap = {
  description: 'Swap tokens between chains. Previews by default — pass --confirm to execute.',
  params: {
    from: 'Source chain or chain:token (e.g. Ethereum or Ethereum:USDC)',
    to: 'Destination chain or chain:token',
    amount: 'Amount to swap in human-readable units (e.g. "0.1")',
    confirmed: 'Set true to execute. Omit or false for a dry-run preview.',
  },
} as const

export const send = {
  description: 'Send tokens to an address. Previews by default — pass --confirm to execute.',
  params: {
    chain: 'Chain to send on (e.g. Ethereum)',
    to: 'Recipient address',
    amount: 'Amount to send in human-readable units, or "max" for full balance minus fees',
    token: 'Token symbol for ERC-20/SPL tokens (omit for native token)',
    memo: 'Transaction memo (non-EVM chains only)',
    confirmed: 'Set true to execute. Omit or false for a dry-run preview.',
  },
} as const

import type { Chain, VaultBase } from '@vultisig/sdk'

export type EventLogEntry = {
  id: string
  timestamp: Date
  type: EventType
  source: 'sdk' | 'vault'
  message: string
  data?: any
}

export type EventType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'balance'
  | 'transaction'
  | 'signing'
  | 'vault'
  | 'chain'

export type AppState = {
  sdk: any | null
  openVaults: Map<string, VaultBase> // Map of vaultId -> VaultBase instance
  events: EventLogEntry[]
  isLoading: boolean
  error: string | null
}

export type TransactionFormData = {
  chain: Chain
  recipient: string
  amount: string
  tokenId?: string
  memo?: string
}

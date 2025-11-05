import type { Balance } from '../../types'

/**
 * Events emitted by the provider for state changes.
 * Consumers can listen to these for reactive updates.
 */
export interface ProviderEvents extends Record<string, unknown> {
  /** Emitted when provider successfully connects */
  connect: void

  /** Emitted when provider disconnects */
  disconnect: void

  /** Emitted when active accounts change for a chain */
  accountsChanged: {
    chain: string
    accounts: string[]
  }

  /** Emitted when active chain changes */
  chainChanged: {
    chain: string
  }

  /** Emitted when active vault changes */
  vaultChanged: {
    vaultId: string
  }

  /** Emitted when a balance is fetched or updated */
  balanceUpdated: {
    chain: string
    balance: Balance
  }

  /** Emitted on errors */
  error: Error
}

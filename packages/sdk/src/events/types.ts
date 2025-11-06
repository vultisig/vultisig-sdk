import type { Balance, Signature, SigningPayload, Token } from '../types'

/**
 * Events emitted by the Vultisig SDK for state changes.
 * Consumers can listen to these for reactive updates.
 */
export interface SdkEvents extends Record<string, unknown> {
  /** Emitted when SDK successfully connects */
  connect: void

  /** Emitted when SDK disconnects */
  disconnect: void

  /** Emitted when active chain changes */
  chainChanged: {
    chain: string
  }

  /** Emitted when active vault changes */
  vaultChanged: {
    vaultId: string
  }

  /** Emitted on SDK-level errors */
  error: Error
}

/**
 * Events emitted by individual Vault instances.
 * Allows reactive updates for vault-specific operations.
 */
export interface VaultEvents extends Record<string, unknown> {
  /** Emitted when a balance is fetched or updated */
  balanceUpdated: {
    chain: string
    balance: Balance
    tokenId?: string
  }

  /** Emitted when a transaction is signed */
  transactionSigned: {
    signature: Signature
    payload: SigningPayload
  }

  /** Emitted when a chain is added to the vault */
  chainAdded: {
    chain: string
  }

  /** Emitted when a chain is removed from the vault */
  chainRemoved: {
    chain: string
  }

  /** Emitted when a token is added */
  tokenAdded: {
    chain: string
    token: Token
  }

  /** Emitted when a token is removed */
  tokenRemoved: {
    chain: string
    tokenId: string
  }

  /** Emitted when vault is renamed */
  renamed: {
    oldName: string
    newName: string
  }

  /** Emitted on vault-level errors */
  error: Error
}

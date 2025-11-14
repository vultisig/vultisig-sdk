import type { Chain } from '@core/chain/Chain'

import type { Balance, Signature, SigningPayload, Token } from '../types'

/**
 * Events emitted by the Vultisig SDK for state changes.
 * Consumers can listen to these for reactive updates.
 */
export type SdkEvents = {
  /** Emitted when SDK successfully connects */
  connect: void

  /** Emitted when SDK disconnects */
  disconnect: void

  /** Emitted when active chain changes */
  chainChanged: {
    chain: Chain
  }

  /** Emitted when active vault changes */
  vaultChanged: {
    vaultId: string
  }

  /** Emitted when all SDK data is cleared from storage */
  dataCleared: Record<string, never>

  /** Emitted on SDK-level errors */
  error: Error
} & Record<string, unknown>

/**
 * Events emitted by individual Vault instances.
 * Allows reactive updates for vault-specific operations.
 */
export type VaultEvents = {
  /** Emitted when a balance is fetched or updated */
  balanceUpdated: {
    chain: Chain
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
    chain: Chain
  }

  /** Emitted when a chain is removed from the vault */
  chainRemoved: {
    chain: Chain
  }

  /** Emitted when a token is added */
  tokenAdded: {
    chain: Chain
    token: Token
  }

  /** Emitted when a token is removed */
  tokenRemoved: {
    chain: Chain
    tokenId: string
  }

  /** Emitted when vault is renamed */
  renamed: {
    oldName: string
    newName: string
  }

  /** Emitted on vault-level errors */
  error: Error
} & Record<string, unknown>

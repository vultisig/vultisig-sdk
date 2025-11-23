import type { Chain } from '@core/chain/Chain'

import type {
  Balance,
  Signature,
  SigningPayload,
  SigningStep,
  Token,
  Value,
  VaultCreationStep,
} from '../types'
import type { VaultBase } from '../vault/VaultBase'

/**
 * Events emitted by the Vultisig SDK for state changes.
 * Consumers can listen to these for reactive updates.
 */
export type SdkEvents = {
  /** Emitted when SDK successfully connects */
  connect: Record<string, never>

  /** Emitted when SDK disconnects */
  disconnect: Record<string, never>

  /** Emitted when active vault changes */
  vaultChanged: {
    vaultId: string
  }

  /** Emitted on SDK-level errors */
  error: Error

  /** Emitted during vault creation with progress updates */
  vaultCreationProgress: {
    vault?: VaultBase // undefined until vault object created, then populated
    step: VaultCreationStep
  }

  /** Emitted when vault creation completes successfully */
  vaultCreationComplete: {
    vault: VaultBase
  }
}

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

  /** Emitted when fiat values are updated for a chain */
  valuesUpdated: {
    chain: Chain | 'all'
  }

  /** Emitted when total portfolio value is recalculated */
  totalValueUpdated: {
    value: Value
  }

  /** Emitted on vault-level errors */
  error: Error

  /** Emitted during transaction signing with progress updates */
  signingProgress: {
    step: SigningStep
  }

  /** Emitted when a transaction is successfully broadcast to the blockchain network */
  transactionBroadcast: {
    /** The chain the transaction was broadcast on */
    chain: Chain
    /** The transaction hash returned by the network */
    txHash: string
    /** The original keysign payload used to create the transaction */
    keysignPayload: any
  }

  /** Emitted when vault is saved to storage */
  saved: {
    vaultId: string
  }

  /** Emitted when vault is deleted from storage */
  deleted: {
    vaultId: string
  }

  /** Emitted when vault is loaded from storage */
  loaded: {
    vaultId: string
  }

  /** Emitted when vault is unlocked (keyshares loaded) */
  unlocked: {
    vaultId: string
  }

  /** Emitted when vault is locked (keyshares cleared) */
  locked: Record<string, never>
}

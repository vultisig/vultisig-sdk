import type { Chain } from '@core/chain/Chain'

import type { Balance, Signature, SigningPayload, SigningStep, Token, Value, VaultCreationStep } from '../types'
import type { SwapQuoteResult } from '../vault/swap-types'
import type { VaultBase } from '../vault/VaultBase'

/**
 * Events emitted by the Vultisig SDK for state changes.
 * Consumers can listen to these for reactive updates.
 */
export type SdkEvents = {
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

  /** Emitted when SDK instance is disposed */
  disposed: Record<string, never>
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

  // ===== SECURE VAULT EVENTS =====

  /** Emitted when QR code is ready for device pairing (SecureVault) */
  qrCodeReady: {
    /** The QR payload URL to display */
    qrPayload: string
    /** The action being performed */
    action: 'keygen' | 'keysign'
    /** Session ID for the operation */
    sessionId: string
  }

  /** Emitted when a device joins the session (SecureVault) */
  deviceJoined: {
    /** Device ID that joined */
    deviceId: string
    /** Total devices joined so far */
    totalJoined: number
    /** Total devices required */
    required: number
  }

  /** Emitted when all required devices have joined (SecureVault) */
  allDevicesReady: {
    /** List of all device IDs */
    devices: string[]
    /** Session ID */
    sessionId: string
  }

  /** Emitted during keygen with phase progress (SecureVault) */
  keygenProgress: {
    /** Current keygen phase */
    phase: 'ecdsa' | 'eddsa' | 'complete'
    /** Optional round number */
    round?: number
    /** Optional status message */
    message?: string
  }

  // ===== SWAP EVENTS =====

  /** Emitted when a swap quote is received */
  swapQuoteReceived: {
    quote: SwapQuoteResult
  }

  /** Emitted when ERC-20 approval is required before swap */
  swapApprovalRequired: {
    /** Token symbol or contract address */
    token: string
    /** Spender contract address (DEX router) */
    spender: string
    /** Required approval amount */
    amount: string
    /** Current allowance */
    currentAllowance: string
  }

  /** Emitted when ERC-20 approval is granted */
  swapApprovalGranted: {
    /** Token symbol or contract address */
    token: string
    /** Transaction hash of approval */
    txHash: string
  }

  /** Emitted when swap transaction is prepared for signing */
  swapPrepared: {
    /** Swap provider used */
    provider: string
    /** Amount being swapped */
    fromAmount: string
    /** Expected output amount */
    toAmountExpected: string
    /** Whether approval is required */
    requiresApproval: boolean
  }
}

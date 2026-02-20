import type { AccountData, DirectSignResponse, OfflineDirectSigner } from '@cosmjs/proto-signing'

type SignDoc = Parameters<OfflineDirectSigner['signDirect']>[1]

export type RujiraSigner = {
  getAccounts(): Promise<readonly AccountData[]>
  signDirect(signerAddress: string, signDoc: SignDoc): Promise<DirectSignResponse>
} & OfflineDirectSigner

export type VultisigChain = 'THORChain' | 'MayaChain' | string

export type VultisigSignature = {
  signature: string
  recovery?: number
  format: 'DER' | 'ECDSA' | 'EdDSA' | 'Ed25519'
}

export type SignDirectInput = {
  chain: VultisigChain
  coin: {
    chain: VultisigChain
    address: string
    decimals: number
    ticker: string
  }
  bodyBytes: string
  authInfoBytes: string
  chainId: string
  accountNumber: string
  memo?: string
}

export type SigningPayload = {
  transaction: KeysignPayload
  chain: VultisigChain
  messageHashes: string[]
}

import type { KeysignPayload } from '@vultisig/sdk'
export type { KeysignPayload }

export type VultisigVault = {
  address(chain: VultisigChain): Promise<string>
  readonly publicKeys: {
    readonly ecdsa: string
    readonly eddsa: string
  }
  prepareSignDirectTx(input: SignDirectInput, options?: { skipChainSpecificFetch?: boolean }): Promise<KeysignPayload>
  extractMessageHashes(keysignPayload: KeysignPayload): Promise<string[]>
  sign(payload: SigningPayload, options?: { signal?: AbortSignal }): Promise<VultisigSignature>
  broadcastTx(params: {
    chain: VultisigChain
    keysignPayload: KeysignPayload
    signature: VultisigSignature
  }): Promise<string>
}

/**
 * Vault with full withdraw capabilities (sign + broadcast).
 * Used by RujiraWithdraw to execute MsgDeposit-based withdrawals.
 */
export type WithdrawCapableVault = {
  extractMessageHashes(keysignPayload: KeysignPayload): Promise<string[]>
  sign(payload: SigningPayload, options?: { signal?: AbortSignal }): Promise<VultisigSignature>
  broadcastTx(params: {
    chain: VultisigChain
    keysignPayload: KeysignPayload
    signature: VultisigSignature
  }): Promise<string>
} & VultisigVault

/**
 * Type guard: checks if a VultisigVault satisfies WithdrawCapableVault
 */
export function isWithdrawCapable(vault: VultisigVault): vault is WithdrawCapableVault {
  return (
    typeof vault.extractMessageHashes === 'function' &&
    typeof vault.sign === 'function' &&
    typeof vault.broadcastTx === 'function'
  )
}

export type ExtendedAccountData = {
  accountNumber?: number
  sequence?: number
} & AccountData

export type SigningResult = {
  signedTxBytes: Uint8Array
  signature: Uint8Array
  pubKey: Uint8Array
}

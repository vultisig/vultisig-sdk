import { buildTonJettonTransferTx, type TonWalletCoreBackedTxBuilderResult } from '../../chains/ton/tx'
import type { VaultIdentity } from './types'

/**
 * Parameters for `prepareJettonTransferTxFromKeys`.
 *
 * A Jetton is TON's fungible-token standard (the ERC-20 / TRC-20 equivalent).
 * Unlike a native TON send, a Jetton transfer is an *internal message to the
 * sender's Jetton wallet contract* carrying the `transfer` opcode (0xf8a7ea5),
 * the amount, and the ultimate recipient — the sender's Jetton wallet then
 * forwards the tokens. Callers must therefore supply the sender's Jetton
 * wallet address (resolved off-chain via toncenter `/getJettonWalletAddress`
 * or the on-chain `get_wallet_address` getter), NOT the Jetton master.
 */
export type PrepareJettonTransferTxFromKeysParams = {
  /** Ultimate recipient TON address (where the Jettons end up). */
  receiver: string
  /**
   * Sender's *Jetton wallet* address — the per-owner contract that holds this
   * Jetton for the sender. NOT the Jetton master and NOT the sender's TON
   * wallet. Resolve via toncenter `/getJettonWalletAddress` or the SDK's TON
   * RPC helpers before calling.
   */
  jettonWalletAddress: string
  /** Amount in the Jetton's minimal units (per the Jetton metadata decimals). */
  amount: bigint
  /** Whether the recipient account is initialized. Defaults to true for backward compatibility. */
  isActiveDestination?: boolean
  /** Optional UTF-8 forward comment; must fit WalletCore's inline Jetton payload. The cap shrinks as `amount` grows (larger VarUInteger encoding leaves fewer bits) — at most ~34 ASCII bytes for large amounts, ~39 for small ones. Throws if it doesn't fit. */
  memo?: string
  /**
   * Sender wallet seqno from `getTonWalletInfo(from).seqno`. First-ever send = 0
   * (StateInit is attached automatically in that case). MUST be fresh at sign
   * time or the broadcast is rejected with `external message was not accepted`.
   */
  seqno: number
  /** Unix-seconds expiry. Defaults to now + 600 inside the cell builder. */
  validUntil?: number
  /** Sender wallet workchain. Default 0 (basechain). */
  workchain?: number
}

/**
 * Build an UNSIGNED TON Jetton transfer from raw vault identity, without an
 * instantiated vault. Vault-free sibling of the other `prepare*FromKeys`
 * helpers — for MCP servers / agent backends that hold only the public
 * identity (no key shares).
 *
 * This is PURE CRYPTO: it constructs the unsigned signing-payload BoC + the
 * V4R2 external-message envelope and returns a `finalize(sigHex)` closure. It
 * NEVER signs and NEVER broadcasts — `vault.sign` stays on-device. The
 * returned `signingHashHex` is what the EdDSA MPC engine signs. Pass the
 * accompanying `walletCoreTxInputData` to `fastVaultSign` so it can verify
 * the hash independently before dispatch, then feed the resulting 64-byte
 * Ed25519 signature through `finalize` to obtain the broadcast-ready BoC.
 *
 * For TON the wallet's Ed25519 key is the vault's root EdDSA public key
 * directly (no chain-code derivation), so `identity.eddsaPublicKey` is passed
 * straight through to the V4R2 wallet builder.
 *
 * @example
 * ```ts
 * const tx = prepareJettonTransferTxFromKeys(identity, {
 *   receiver: 'UQ...recipient',
 *   jettonWalletAddress: 'EQ...senderJettonWallet',
 *   amount: 1_000_000n, // 1 USDT (6 decimals)
 *   seqno: 5,
 * })
 * // tx.signingHashHex -> EdDSA MPC sign -> tx.finalize(sigHex).signedBocBase64
 * ```
 */
export const prepareJettonTransferTxFromKeys = (
  identity: VaultIdentity,
  params: PrepareJettonTransferTxFromKeysParams
): TonWalletCoreBackedTxBuilderResult => {
  if (params.amount <= 0n) {
    throw new Error('Amount must be greater than zero')
  }
  if (!identity.eddsaPublicKey) {
    throw new Error('Vault EdDSA public key required for TON Jetton transfer')
  }

  return buildTonJettonTransferTx({
    publicKeyEd25519: identity.eddsaPublicKey,
    to: params.receiver,
    jettonWalletAddress: params.jettonWalletAddress,
    amount: params.amount,
    isActiveDestination: params.isActiveDestination,
    memo: params.memo,
    seqno: params.seqno,
    validUntil: params.validUntil,
    workchain: params.workchain,
  })
}

import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { assertSafeDestination } from '@vultisig/core-chain/security/dangerousAddresses'
import { assertSafeTokenTransferDestination } from '@vultisig/core-chain/security/tokenTransferGuards'
import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import type { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type PrepareSendTxFromKeysParams = {
  coin: AccountCoin
  receiver: string
  amount: bigint
  memo?: string
  /** XRPL DestinationTag, independent from the transaction memo. */
  destinationTag?: number
  feeSettings?: FeeSettings
  /**
   * Set when this came from a MAX button, so the payload records it instead of the
   * SDK guessing from how close `amount` sits to the balance. `amount` is still the
   * exact figure signed — pass the same `balance - fee` the UI displayed.
   */
  sendMaxAmount?: boolean
}

/**
 * Build a send-transaction `KeysignPayload` from raw vault identity fields,
 * without requiring an instantiated vault. This is the vault-free equivalent of
 * `vault.transactionBuilder.prepareSendTx()` and is intended for MCP servers and
 * other contexts where only the public identity (no key shares) is available.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 *
 * @example
 * ```ts
 * const payload = await prepareSendTxFromKeys(identity, {
 *   coin: { chain: 'Ethereum', address: '0x...', decimals: 18, ticker: 'ETH' },
 *   receiver: '0x...',
 *   amount: 1500000000000000000n,
 * })
 * ```
 */
export const prepareSendTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareSendTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  if (params.amount <= 0n) {
    throw new Error('Amount must be greater than zero')
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const isValid = isValidAddress({
    chain: params.coin.chain,
    address: params.receiver,
    walletCore,
  })
  if (!isValid) {
    throw new Error(`Invalid receiver address for chain ${params.coin.chain}: ${params.receiver}`)
  }

  // Fund-safety: reject known burn/dead/dangerous addresses before building
  // the keysign payload. assertSafeDestination is chain-aware and shape-based
  // for EVM (any 0x+40-hex address is vetted regardless of chain label), so
  // newly-added EVM chains don't escape the guard automatically.
  assertSafeDestination(params.coin.chain, params.receiver)

  // Fund-safety: reject sends where the recipient equals the token's own
  // contract address. Tokens sent to their own contract are unrecoverable for
  // almost all users (the contract has no sweep path for arbitrary senders).
  // This applies to ERC-20 and any token where `coin.id` encodes the contract
  // address — native sends (no `coin.id`) are unaffected. Kept as an
  // UNCONDITIONAL check (not registry-gated) so a brand-new/unlisted token's
  // own contract is caught even before it's indexed anywhere.
  if (params.coin.id !== undefined && params.coin.id.trim().toLowerCase() === params.receiver.trim().toLowerCase()) {
    throw new Error(
      `Refusing to build transaction: recipient ${params.receiver} is the token contract address for ${params.coin.ticker}. Sending tokens to their own contract is almost certainly a mistake and funds would be unrecoverable.`
    )
  }

  // Fund-safety (architecture#1774): reject sends where the recipient is a
  // DIFFERENT known token's contract (not the one being sent — that case is
  // already caught above). Registry-based (only fires for a contract in
  // `knownTokensIndex`), so it's additive coverage on top of the unconditional
  // self-check, not a replacement for it.
  assertSafeTokenTransferDestination(params.coin.chain, params.receiver, params.coin.id)

  const isQbtc = params.coin.chain === Chain.QBTC

  const publicKey = isQbtc
    ? null
    : getPublicKey({
        chain: params.coin.chain,
        walletCore,
        publicKeys: {
          ecdsa: identity.ecdsaPublicKey,
          eddsa: identity.eddsaPublicKey,
        },
        hexChainCode: identity.hexChainCode,
        chainPublicKeys: identity.chainPublicKeys,
      })

  const hexPublicKeyOverride = isQbtc
    ? shouldBePresent(identity.publicKeyMldsa, 'Vault MLDSA public key required for QBTC send')
    : undefined

  return buildSendKeysignPayload({
    coin: params.coin,
    receiver: params.receiver,
    amount: params.amount,
    memo: params.memo,
    destinationTag: params.destinationTag,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    hexPublicKeyOverride,
    walletCore,
    libType: identity.libType,
    feeSettings: params.feeSettings,
    sendMaxAmount: params.sendMaxAmount,
  })
}

import type { WalletCore } from '@trustwallet/wallet-core'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import {
  cloneSwapSafetyValue,
  getSwapQuoteSafetyFingerprint,
} from '@vultisig/core-chain/swap/quote/getSwapQuoteSafetyFingerprint'
import type { BoundSwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { buildSwapKeysignPayload } from '@vultisig/core-mpc/keysign/swap/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getWalletCore } from '../../context/wasmRuntime'
import { decodeEvmGeneralSwapCommitment } from './decodeEvmGeneralSwapCommitment'
import type { VaultIdentity } from './types'

export type PrepareSwapTxFromKeysParams = {
  fromCoin: AccountCoin
  toCoin: AccountCoin
  amount: string | number
  /** Live bound quote returned by `findSwapQuote`; do not JSON round-trip it. */
  swapQuote: BoundSwapQuote
}

/** Catchable signal that the caller should fetch a fresh quote and retry. */
export class SwapQuoteExpiredError extends Error {
  readonly code = 'SWAP_QUOTE_EXPIRED'

  constructor(message: string) {
    super(message)
    this.name = 'SwapQuoteExpiredError'
  }
}

// Snapshot all amount/coin/quote inputs synchronously. Validation and payload construction must
// consume the same immutable-by-ownership copy: wallet and UTXO resolution both yield, so retaining
// caller-owned objects after the fingerprint check would create a mutation window before signing.
const snapshotPreparationParams = (params: PrepareSwapTxFromKeysParams): PrepareSwapTxFromKeysParams =>
  cloneSwapSafetyValue(params)

// Fund-safety, agent-reachable (audit ABTS-005/plan 005): this is the vault-free swap builder,
// so it validates the source amount and expiry bound by `findSwapQuote` before any wallet-core or
// public-key work. Embedded native/CoW deadlines are retained below as defense-in-depth.
const assertQuoteSafetyBinding = (params: PrepareSwapTxFromKeysParams, requestedAmount: bigint): void => {
  const { swapQuote } = params
  const { requestedAmount: boundAmount, expiresAt, safetyFingerprint } = swapQuote
  if (
    typeof boundAmount !== 'bigint' ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    typeof safetyFingerprint !== 'string'
  ) {
    throw new Error(
      'prepareSwapTxFromKeys: swap quote is missing its amount/expiry safety binding; refresh it with findSwapQuote before signing'
    )
  }
  if (expiresAt <= Date.now()) {
    throw new SwapQuoteExpiredError('prepareSwapTxFromKeys: swap quote has expired; refresh the quote before signing')
  }
  if (boundAmount !== requestedAmount) {
    throw new Error(
      `prepareSwapTxFromKeys: requested amount (${requestedAmount} base units) does not match the quote's requested source amount (${boundAmount} base units) — the quote may be stale or for a different request`
    )
  }
  const expectedFingerprint = getSwapQuoteSafetyFingerprint({
    from: params.fromCoin,
    to: params.toCoin,
    requestedAmount: boundAmount,
    expiresAt,
    quote: swapQuote.quote,
  })
  if (safetyFingerprint !== expectedFingerprint) {
    throw new Error(
      'prepareSwapTxFromKeys: swap quote does not match the requested coins, amount, value types, or original transaction; fetch a fresh quote without JSON round-tripping it'
    )
  }
}

// Native-quote expiry (`quote.native.expiry`) is a real absolute deadline sourced from the
// THORChain/Maya quote API. CoW's `validTo` is the deadline on the EIP-712 order itself.
const assertNativeQuoteNotExpired = (expirySeconds: number): void => {
  if (expirySeconds <= Math.floor(Date.now() / 1000)) {
    throw new SwapQuoteExpiredError(
      'prepareSwapTxFromKeys: native swap quote has expired; refresh the quote before signing'
    )
  }
}

const assertCowQuoteNotExpired = (validTo: number): void => {
  if (validTo <= Math.floor(Date.now() / 1000)) {
    throw new SwapQuoteExpiredError(
      'prepareSwapTxFromKeys: CoW swap order has expired (validTo in the past); refresh the quote before signing'
    )
  }
}

// Defense-in-depth: the quote-level requested amount must also match a value
// committed inside the signable payload when we can read one. CoW exposes
// sellAmount+feeAmount on the order. EVM-general quotes bury the sell in
// aggregator calldata — decode known exact-in shapes and compare; unknown
// selectors stay fail-open (a wrong decode would brick valid swaps).
// `transfer.amount` may legitimately differ (for example, 100_000n -> 99_999n)
// because providers subtract deposit-channel fees.
const assertAmountMatchesCommittedSellAmount = (params: PrepareSwapTxFromKeysParams): void => {
  const { quote } = params.swapQuote
  if (!('general' in quote)) return

  const committed = matchRecordUnion(quote.general.tx, {
    evm: tx => decodeEvmGeneralSwapCommitment(tx.data, tx.value)?.sellAmount,
    solana: () => undefined,
    transfer: () => undefined,
    cowswap_order: order => BigInt(order.sellAmount) + BigInt(order.feeAmount),
  })
  if (committed === undefined) return

  const requested = toChainAmount(params.amount, params.fromCoin.decimals)
  if (requested !== committed) {
    const label =
      'cowswap_order' in quote.general.tx
        ? "CoW order's committed gross sell amount"
        : 'committed sell amount encoded in the EVM swap calldata'
    throw new Error(
      `prepareSwapTxFromKeys: requested amount (${requested} base units) does not match the ${label} (${committed} base units) — the quote may be stale or for a different request`
    )
  }
}

const assertEvmGeneralDeadlineNotExpired = (params: PrepareSwapTxFromKeysParams): void => {
  const { quote } = params.swapQuote
  if (!('general' in quote) || !('evm' in quote.general.tx)) return

  const decoded = decodeEvmGeneralSwapCommitment(quote.general.tx.evm.data, quote.general.tx.evm.value)
  if (decoded?.deadlineSeconds === undefined) return
  if (!Number.isFinite(decoded.deadlineSeconds)) return
  if (decoded.deadlineSeconds <= Math.floor(Date.now() / 1000)) {
    throw new SwapQuoteExpiredError(
      'prepareSwapTxFromKeys: EVM swap calldata deadline has expired; refresh the quote before signing'
    )
  }
}

/**
 * Build a swap-transaction `KeysignPayload` from raw vault identity fields,
 * without requiring an instantiated vault. This is the vault-free equivalent of
 * the payload-building portion of `SwapService.prepareSwapTx` and is intended
 * for MCP servers and other contexts where only the public identity (no key
 * shares) is available.
 *
 * Coin-input resolution must be performed by the caller — the vault layer owns
 * that responsibility because it requires `getAddress`. This helper enforces
 * quote expiry and caller-amount↔quote consistency itself, so every caller —
 * vault-wrapped and vault-free alike — gets those checks. The raw quote must
 * come from `findSwapQuote`, which binds the requested base-unit amount and an
 * absolute expiry before returning it.
 *
 * If the swap requires an ERC-20 approval, the resulting payload will have
 * `erc20ApprovePayload` set by core; this wrapper returns the payload as-is
 * without extracting it.
 *
 * Note: swaps don't apply to QBTC, so both public keys are always non-null.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 */
export const prepareSwapTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareSwapTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  const safeParams = snapshotPreparationParams(params)
  const { quote } = safeParams.swapQuote
  const requestedAmount = toChainAmount(safeParams.amount, safeParams.fromCoin.decimals)
  assertQuoteSafetyBinding(safeParams, requestedAmount)
  if ('native' in quote) {
    assertNativeQuoteNotExpired(quote.native.expiry)
  }
  if ('general' in quote && 'cowswap_order' in quote.general.tx) {
    assertCowQuoteNotExpired(quote.general.tx.cowswap_order.validTo)
  }
  assertEvmGeneralDeadlineNotExpired(safeParams)
  assertAmountMatchesCommittedSellAmount(safeParams)

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const fromPublicKey = getPublicKey({
    chain: safeParams.fromCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  const toPublicKey = getPublicKey({
    chain: safeParams.toCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  return buildSwapKeysignPayload({
    fromCoin: safeParams.fromCoin,
    toCoin: safeParams.toCoin,
    amount: safeParams.amount,
    swapQuote: safeParams.swapQuote,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    fromPublicKey,
    toPublicKey,
    libType: identity.libType,
    walletCore,
  })
}

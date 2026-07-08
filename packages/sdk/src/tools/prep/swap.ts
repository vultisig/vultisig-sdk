import type { WalletCore } from '@trustwallet/wallet-core'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import type { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { buildSwapKeysignPayload } from '@vultisig/core-mpc/keysign/swap/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type PrepareSwapTxFromKeysParams = {
  fromCoin: AccountCoin
  toCoin: AccountCoin
  amount: string | number
  swapQuote: SwapQuote
}

// Fund-safety, agent-reachable (audit ABTS-005/plan 005): this is the vault-free swap builder,
// so it's the one path an agent (no key shares) can drive. It previously enforced NEITHER quote
// expiry NOR amount↔quote consistency, unlike the vault-wrapped `SwapService.prepareSwapTx`.
//
// Native-quote expiry (`quote.native.expiry`) is a REAL absolute deadline sourced from the
// THORChain/Maya quote API — mirrors core's own `assertQuoteNotExpired`
// (nativeSwapQuoteToSwapPayload.ts). General quotes carry NO expiry field at this layer at all:
// the `expiresAt` `SwapService.prepareSwapTx` checks is an artificial SDK-wrapper clock computed
// fresh at fetch time (`Date.now() + DEFAULT_QUOTE_EXPIRY_MS`), not data the quote itself carries
// — there's nothing meaningful to enforce here for general quotes, so this only covers native.
const assertNativeQuoteNotExpired = (expirySeconds: number): void => {
  if (expirySeconds <= Math.floor(Date.now() / 1000)) {
    throw new Error('prepareSwapTxFromKeys: native swap quote has expired; refresh the quote before signing')
  }
}

// Cross-checks the caller's `amount` against the quote's own committed sell amount, but ONLY
// where the quote confidently commits to one independent of the caller's input:
// - `general.transfer` (UTXO/Cosmos deposit-channel routes): `tx.transfer.amount` is exactly what
//   gets signed (`build.ts`'s `transferTx?.amount ?? toChainAmount(amount, ...)` prefers it).
// - `general.cowswap_order`: `tx.cowswap_order.sellAmount` is the EIP-712 order's actual signed
//   sell amount — the caller's `amount` never reaches the signed order for CoW at all.
// Native quotes carry no committed-sell-amount field anywhere (checked the type + the live
// THORChain/Maya quote response shape); `evm`/`solana` general quotes encode the amount inside
// opaque aggregator calldata. Both fail OPEN here — do not invent a comparison that could
// false-reject a legitimate swap just because we can't confidently verify it.
const assertAmountMatchesCommittedSellAmount = (params: PrepareSwapTxFromKeysParams): void => {
  const { quote } = params.swapQuote
  if (!('general' in quote)) return

  const committed = matchRecordUnion(quote.general.tx, {
    evm: () => undefined,
    solana: () => undefined,
    transfer: tx => tx.amount,
    cowswap_order: order => BigInt(order.sellAmount),
  })
  if (committed === undefined) return

  const requested = toChainAmount(params.amount, params.fromCoin.decimals)
  if (requested !== committed) {
    throw new Error(
      `prepareSwapTxFromKeys: requested amount (${requested} base units) does not match the quote's committed sell amount (${committed} base units) — the quote may be stale or for a different request`
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
 * quote-expiry (native quotes) and amount↔quote consistency (general quotes
 * with a confidently-comparable committed sell amount) itself, so every
 * caller — vault-wrapped and vault-free alike — gets those checks; see the
 * inline reasoning above `assertNativeQuoteNotExpired` /
 * `assertAmountMatchesCommittedSellAmount` for exactly what is and isn't
 * covered.
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
  const { quote } = params.swapQuote
  if ('native' in quote) {
    assertNativeQuoteNotExpired(quote.native.expiry)
  }
  assertAmountMatchesCommittedSellAmount(params)

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const fromPublicKey = getPublicKey({
    chain: params.fromCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  const toPublicKey = getPublicKey({
    chain: params.toCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  return buildSwapKeysignPayload({
    fromCoin: params.fromCoin,
    toCoin: params.toCoin,
    amount: params.amount,
    swapQuote: params.swapQuote,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    fromPublicKey,
    toPublicKey,
    libType: identity.libType,
    walletCore,
  })
}

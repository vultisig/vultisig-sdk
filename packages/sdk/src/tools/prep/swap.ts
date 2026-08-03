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
// (nativeSwapQuoteToSwapPayload.ts).
// CoW-swap expiry (`cowswap_order.validTo`) is a Unix-second deadline on the EIP-712 order itself.
// Other general-quote routes carry no expiry field the SDK can assert here.
const assertNativeQuoteNotExpired = (expirySeconds: number): void => {
  if (expirySeconds <= Math.floor(Date.now() / 1000)) {
    throw new Error('prepareSwapTxFromKeys: native swap quote has expired; refresh the quote before signing')
  }
}

const assertCowQuoteNotExpired = (validTo: number): void => {
  if (validTo <= Math.floor(Date.now() / 1000)) {
    throw new Error(
      'prepareSwapTxFromKeys: CoW swap order has expired (validTo in the past); refresh the quote before signing'
    )
  }
}

// Cross-checks the caller's `amount` against the quote's CoW gross sell amount only.
// `general.transfer` amount is provider-committed and legitimately diverges from the caller's
// input by small fee adjustments (e.g. request 100_000n → committed 99_999n), so an exact
// comparison would false-reject every UTXO/Cosmos SwapKit route. For CoW the gross value
// (sellAmount + feeAmount) is what gets committed to the EIP-712 order the caller must sign,
// and the caller's amount is expected to match it exactly.
// Native/evm/solana fail open — no confidently-comparable committed sell field is available.
const assertAmountMatchesCommittedSellAmount = (params: PrepareSwapTxFromKeysParams): void => {
  const { quote } = params.swapQuote
  if (!('general' in quote)) return

  const committed = matchRecordUnion(quote.general.tx, {
    evm: () => undefined,
    solana: () => undefined,
    transfer: () => undefined,
    cowswap_order: order => BigInt(order.sellAmount) + BigInt(order.feeAmount),
  })
  if (committed === undefined) return

  const requested = toChainAmount(params.amount, params.fromCoin.decimals)
  if (requested !== committed) {
    throw new Error(
      `prepareSwapTxFromKeys: requested amount (${requested} base units) does not match the CoW order's committed gross sell amount (${committed} base units) — the quote may be stale or for a different request`
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
  if ('general' in quote && 'cowswap_order' in quote.general.tx) {
    assertCowQuoteNotExpired(quote.general.tx.cowswap_order.validTo)
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

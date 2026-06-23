import { normalizeStructTag } from '@mysten/sui/utils'
import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'

import { prepareSendTxFromKeys } from './send'
import type { VaultIdentity } from './types'

/**
 * The on-chain coin type of native SUI. A Sui *token* transfer is any
 * `coinType` other than this one. Native SUI sends should go through
 * `prepareSendTxFromKeys` directly (no `coinType`), which produces a `PaySui`
 * signing input; a non-native `coinType` produces a `Pay` signing input over
 * the matching coin objects (see
 * `core/mpc/keysign/signingInputs/resolvers/sui.ts`).
 */
export const SUI_NATIVE_COIN_TYPE = '0x2::sui::SUI'

/**
 * Canonical (32-byte zero-padded package id) form of native SUI. Sui treats
 * `0x2`, `0x02` and the full `0x000…002` package id as the SAME address, so a
 * naive `=== '0x2::sui::SUI'` literal check is bypassable: a caller passing
 * `0x000…002::sui::SUI` is on-chain-identical to native SUI yet slips past a
 * literal guard, gets `coin.id` set, and the signing-input resolver then builds
 * a token `Pay` whose `inputCoins` filter (`coinType === '0x2::sui::SUI'`) matches
 * nothing — an empty / un-signable token payload while the caller believes they
 * built a native send. We normalize the struct tag before comparing so every
 * address-equivalent native form is rejected. The codebase already treats both
 * forms as native in the Sui balance path (mcp-ts `other-balance.ts`).
 */
const SUI_NATIVE_COIN_TYPE_NORMALIZED = normalizeStructTag(SUI_NATIVE_COIN_TYPE)

/**
 * Sui addresses are a `0x` prefix followed by exactly 64 hex characters.
 *
 * This is intentionally stricter than a generic hex check: without it an
 * EVM-shaped `0x` + 40-hex address (or any other family) can pass loosely into
 * the Sui envelope and the value would be sent to the wrong account. Ported
 * from the mcp-ts `build_sui_token_transfer` guard (vultisig/mcp-ts#359).
 */
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/**
 * A Sui coin type looks like `<package>::<module>::<NAME>` where `<package>` is
 * a `0x`-prefixed object id. We validate the shape (not existence) so a clearly
 * malformed coin type fails before we build a payload that can never sign.
 */
const SUI_COIN_TYPE_RE = /^0x[0-9a-fA-F]+::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/

export type PrepareSuiTokenTransferFromKeysParams = {
  /** Sui coin type, e.g. `0x...::usdc::USDC`. Must NOT be native SUI. */
  coinType: string
  /** Sender Sui address (`0x` + 64 hex). */
  from: string
  /** Destination Sui address (`0x` + 64 hex). */
  to: string
  /** Amount in base units (must be > 0). */
  amount: bigint
  /** Token decimals (metadata only; does not affect the signed bytes). */
  decimals?: number
  /** Token ticker (metadata only). */
  ticker?: string
}

/**
 * Build an UNSIGNED Sui coin-object token-transfer `KeysignPayload` from raw
 * vault identity fields, without an instantiated vault.
 *
 * This is the vault-free, pure-crypto equivalent of building a Sui token send
 * card. It NEVER signs or broadcasts — it only constructs the unsigned payload
 * that an on-device `vault.sign(...)` later consumes. The signing material
 * (key shares) is not touched; only the public `VaultIdentity` is required.
 *
 * Under the hood this delegates to {@link prepareSendTxFromKeys} with a token
 * `AccountCoin` whose `id` is the Sui `coinType`. The presence of `id` is what
 * flips the Sui signing-input resolver from a native `PaySui` to a token `Pay`
 * over the matching coin objects, and what drives the `getSuiChainSpecific`
 * resolver to fetch the owner's coin set + reference gas price.
 *
 * Ported from the mcp-ts `build_sui_token_transfer` tool
 * (`src/tools/send/build-other-send.ts`); the curated dangerous-address
 * blocklist stays orchestration-side, the address/coin-type *format* guards are
 * pure crypto and live here.
 *
 * @example
 * ```ts
 * const payload = await prepareSuiTokenTransferFromKeys(identity, {
 *   coinType: '0x5d4b...::coin::COIN',
 *   from: '0x' + 'ab'.repeat(32),
 *   to: '0x' + 'cd'.repeat(32),
 *   amount: 1_000_000n,
 *   decimals: 6,
 *   ticker: 'USDC',
 * })
 * ```
 */
export const prepareSuiTokenTransferFromKeys = async (
  identity: VaultIdentity,
  params: PrepareSuiTokenTransferFromKeysParams,
  walletCoreOverride?: WalletCore
) => {
  const { coinType, from, to, amount, decimals = 0, ticker = 'SUI-TOKEN' } = params

  if (!SUI_COIN_TYPE_RE.test(coinType)) {
    throw new Error(
      `prepareSuiTokenTransferFromKeys: "${coinType}" is not a valid Sui coin type ` +
        '(expected <0xpackage>::<module>::<NAME>).'
    )
  }

  // Canonicalize the struct tag (zero-pad the package id, lowercase the hex)
  // BEFORE doing anything with it. Two reasons:
  //  1. Native-SUI rejection: `0x2`, `0x02` and the full `0x000…002` form are
  //     the SAME on-chain address, so a literal `=== '0x2::sui::SUI'` check is
  //     bypassable — normalize first so every address-equivalent native form is
  //     caught.
  //  2. Coin-object matching: the signing-input resolver selects the token's
  //     input coins with a RAW string equality `coins.filter(c => c.coinType ===
  //     coin.id)`, and the coin objects come back from the RPC in canonical
  //     (zero-padded, lowercase-hex) form. A syntactically valid but
  //     non-canonical caller tag — short package id `0x02::pkg::TOKEN` or
  //     mixed-case hex `0x5D4B…::coin::COIN` — would then match NOTHING even
  //     when the owner holds the token, producing an empty / un-signable token
  //     payload. We forward the normalized tag as `coin.id` so it matches the
  //     on-chain coin objects.
  // `SUI_COIN_TYPE_RE` already guaranteed a well-formed struct tag above, so
  // `normalizeStructTag` won't throw here.
  const normalizedCoinType = normalizeStructTag(coinType)

  // Native SUI is not a token transfer — refuse so callers can't silently
  // produce a broken token payload while believing they built a native send.
  if (normalizedCoinType === SUI_NATIVE_COIN_TYPE_NORMALIZED) {
    throw new Error(
      'prepareSuiTokenTransferFromKeys: coinType is native SUI; ' + 'use prepareSendTxFromKeys for native sends.'
    )
  }

  if (!SUI_ADDRESS_RE.test(from)) {
    throw new Error(
      `prepareSuiTokenTransferFromKeys: from "${from}" is not a valid Sui address ` +
        '(expected 0x followed by 64 hex characters).'
    )
  }

  // Recipient guard mirrors mcp-ts#359: catch wrong-family addresses (e.g. an
  // EVM 0x+40-hex addr) before they reach the Sui envelope. The downstream
  // `prepareSendTxFromKeys` also runs wallet-core's `isValidAddress`, but that
  // check is intentionally redundant — defense in depth on a value-moving path.
  if (!SUI_ADDRESS_RE.test(to)) {
    throw new Error(
      `prepareSuiTokenTransferFromKeys: to "${to}" is not a valid Sui address ` +
        '(expected 0x followed by 64 hex characters).'
    )
  }

  if (amount <= 0n) {
    throw new Error('prepareSuiTokenTransferFromKeys: amount must be greater than zero')
  }

  const coin: AccountCoin = {
    chain: Chain.Sui,
    // Normalized so the downstream raw-string coin-object filter matches the
    // canonical coinType the RPC returns (see normalizedCoinType note above).
    id: normalizedCoinType,
    address: from,
    decimals,
    ticker,
  }

  return prepareSendTxFromKeys(
    identity,
    {
      coin,
      receiver: to,
      amount,
      // Sui has no memo concept; the signing-input resolver throws if one is
      // set, so we never forward one.
    },
    walletCoreOverride
  )
}

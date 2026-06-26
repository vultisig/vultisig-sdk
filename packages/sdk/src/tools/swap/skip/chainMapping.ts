/**
 * Skip Go chain-id ⇄ Vultisig Chain mapping (custody-chain recoverability guard).
 *
 * Skip routes funds across chains; a single-signature PFM/Axelar route is
 * atomic at the SIGNATURE level, but if a hop reverts the funds can come to
 * rest on an intermediate chain. If that chain is one Vultisig can derive a key
 * for, the user holds an address there and the funds are reachable (a recovery
 * tx can be built). If it is a chain Vultisig has NO derivation for, the user
 * has no key and the funds are unrecoverable — so `runSkipSwap` only permits
 * routes whose every custody chain is recoverable.
 *
 * This reuses the SDK's own chain-id lookups (`getCosmosChainByChainId` +
 * `getEvmChainByChainId`) as the single source of truth for "Vultisig can
 * derive a key here" — keeping the guard in sync as the supported-chain set
 * grows instead of hardcoding a list. Skip publishes EVM chain ids as decimal
 * strings ("1", "42161"); the SDK keys EVM chains by 0x-hex, so we bridge with
 * `numberToHex`.
 */
import type { Chain } from '@vultisig/core-chain/Chain'
import { getCosmosChainByChainId } from '@vultisig/core-chain/chains/cosmos/chainInfo'
import { getEvmChainByChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { numberToHex } from '@vultisig/lib-utils/hex/numberToHex'

/**
 * Skip chain_id → Vultisig Chain. Returns `undefined` for chains the SDK has no
 * key derivation for (e.g. agoric-3, celestia, noble-only routes we don't sign).
 *
 * Accepts EVM decimal ids ("1", "42161") and cosmos chain ids ("cosmoshub-4",
 * "osmosis-1", "columbus-5", …).
 */
export function skipChainIdToChainName(skipChainId: string): Chain | undefined {
  // EVM ids arrive as decimal strings; the SDK keys EVM chains by 0x-hex.
  if (/^[1-9][0-9]*$/.test(skipChainId)) {
    const hex = numberToHex(Number(skipChainId))
    const evm = getEvmChainByChainId(hex)
    if (evm) return evm as Chain
  }
  return getCosmosChainByChainId(skipChainId) as Chain | undefined
}

import { describe, expect, it } from 'vitest'

import type {
  ConsolidateChain as ConsolidateChainFromRoot,
  ConsolidateUtxo as ConsolidateUtxoFromRoot,
  NativeSwapMinAmountIn as NativeSwapMinAmountInFromRoot,
  PrepareSuiTokenTransferFromKeysParams as PrepareSuiTokenTransferFromKeysParamsFromRoot,
  PrepareUtxoConsolidateResult as PrepareUtxoConsolidateResultFromRoot,
  PrepareUtxoConsolidateTxFromKeysParams as PrepareUtxoConsolidateTxFromKeysParamsFromRoot,
} from '@/index'
import { getNativeSwapMinAmountIn, NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER } from '@/index'
import type {
  ConsolidateChain as ConsolidateChainFromPrep,
  ConsolidateUtxo as ConsolidateUtxoFromPrep,
  PrepareSuiTokenTransferFromKeysParams as PrepareSuiTokenTransferFromKeysParamsFromPrep,
  PrepareUtxoConsolidateResult as PrepareUtxoConsolidateResultFromPrep,
  PrepareUtxoConsolidateTxFromKeysParams as PrepareUtxoConsolidateTxFromKeysParamsFromPrep,
} from '@/tools/prep'
import type { NativeSwapMinAmountIn as NativeSwapMinAmountInFromTools } from '@/tools/swap'
import {
  getNativeSwapMinAmountIn as getNativeSwapMinAmountInFromTools,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER as NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER_FROM_TOOLS,
} from '@/tools/swap'

// sdk#1542 - the native-swap minimum helper family (`getNativeSwapMinAmountIn`,
// `NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER`, `NativeSwapMinAmountIn`) and the
// Sui/UTXO-consolidate prep companion types were already exported from the
// tools barrels (`@/tools/swap`, `@/tools/prep`) but omitted from the root
// `@vultisig/sdk` entry, pushing root-package consumers toward local
// reimplementations of a swap MINIMUM - drift here is a money bug (a wrong
// minimum gets a swap rejected or filled at a bad rate).
//
// Importing the internal path directly (as the tools/* unit tests do) cannot
// catch a root-barrel omission - these assertions import through the ROOT
// surface specifically.
describe('SDK root exports the native-swap minimum helper family (sdk#1542)', () => {
  it('re-exports getNativeSwapMinAmountIn and NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER as the SAME reference as the tools barrel', () => {
    expect(getNativeSwapMinAmountIn).toBe(getNativeSwapMinAmountInFromTools)
    expect(NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER).toBe(NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER_FROM_TOOLS)
  })
})

/**
 * Type-only exports have no runtime representation, so a missing root
 * re-export cannot fail a plain `vitest run` (esbuild erases type-only
 * imports without resolving whether the imported name actually exists) - it
 * can only fail `tsc --noEmit` (`yarn typecheck`), which is the real gate
 * these mutual-assignability helpers rely on: `assertAssignable` only
 * compiles if root and canonical genuinely name the exact same type. If a
 * root re-export were missing, the FIRST typecheck failure is "has no
 * exported member" on the `@/index` import above, before this function is
 * ever reached.
 */
function assertAssignable<A, B>(_check: (a: A, b: B) => void): true {
  return true
}

describe('SDK root exports the prep companion types (sdk#1542, tsc-gated)', () => {
  it('keeps the root and canonical type names structurally identical', () => {
    assertAssignable<ConsolidateChainFromRoot, ConsolidateChainFromPrep>((a, b) => {
      b = a
      a = b
    })
    assertAssignable<ConsolidateUtxoFromRoot, ConsolidateUtxoFromPrep>((a, b) => {
      b = a
      a = b
    })
    assertAssignable<PrepareSuiTokenTransferFromKeysParamsFromRoot, PrepareSuiTokenTransferFromKeysParamsFromPrep>(
      (a, b) => {
        b = a
        a = b
      }
    )
    assertAssignable<PrepareUtxoConsolidateResultFromRoot, PrepareUtxoConsolidateResultFromPrep>((a, b) => {
      b = a
      a = b
    })
    assertAssignable<PrepareUtxoConsolidateTxFromKeysParamsFromRoot, PrepareUtxoConsolidateTxFromKeysParamsFromPrep>(
      (a, b) => {
        b = a
        a = b
      }
    )
    assertAssignable<NativeSwapMinAmountInFromRoot, NativeSwapMinAmountInFromTools>((a, b) => {
      b = a
      a = b
    })

    expect(true).toBe(true)
  })
})

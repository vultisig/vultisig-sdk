/**
 * sdk#1840: `src/index.ts` documents the Cosmos signing primitives as shipping via
 * `chains.cosmos.buildCosmosStakingTx` "from the platform-specific entry point", but
 * only the React Native entry exposed `chains`. Node / browser / electron / chrome
 * consumers were pushed to deep imports or local tx-builder glue — the opposite of the
 * consolidation the namespace exists for.
 *
 * The React Native entry is deliberately not covered here: importing it needs that
 * suite's RN module harness (see tests/unit/platforms/react-native/entry.test.ts), and
 * it already exposed `chains` anyway — it is the reference, not the regression risk.
 */
import { describe, expect, it } from 'vitest'

import { chains as canonicalChains } from '@/platforms/react-native/chains'

const ENTRYPOINTS = [
  ['node', () => import('@/platforms/node/index')],
  ['browser', () => import('@/platforms/browser/index')],
  ['electron-main', () => import('@/platforms/electron-main/index')],
  ['chrome-extension', () => import('@/platforms/chrome-extension/index')],
] as const

describe('platform entrypoints expose the shared chains namespace (sdk#1840)', () => {
  it.each(ENTRYPOINTS)('%s exposes the SAME chains namespace object', async (_name, load) => {
    const entry = (await load()) as { chains?: typeof canonicalChains }
    // Identity, not shape: a per-platform re-implementation of the namespace would
    // satisfy a `typeof === 'object'` check while reintroducing exactly the drift
    // this namespace exists to prevent.
    expect(entry.chains).toBe(canonicalChains)
  })

  it.each(ENTRYPOINTS)('%s reaches the documented chains.cosmos.buildCosmosStakingTx', async (_name, load) => {
    const entry = (await load()) as { chains?: typeof canonicalChains }
    expect(typeof entry.chains?.cosmos?.buildCosmosStakingTx).toBe('function')
  })

  it('the namespace carries every chain family, not just cosmos', () => {
    // Guards against a partial re-export that satisfies the cosmos assertion above
    // while quietly dropping the rest.
    expect(Object.keys(canonicalChains).sort()).toEqual(
      ['cardano', 'cosmos', 'evm', 'ripple', 'solana', 'sui', 'ton', 'tron', 'utxo'].sort()
    )
  })
})

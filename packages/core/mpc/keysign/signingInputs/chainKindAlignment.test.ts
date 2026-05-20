/**
 * Drift guard: new {@link Chain} values must map to a {@link ChainKind} that
 * has both a signing-input resolver and a WalletCore signing-input encoder
 * class. Forgetting one side produces either a TS error in `chainKindRecord`
 * or a runtime failure here.
 */
import { describe, expect, it } from 'vitest'

import { Chain, type Chain as ChainValue } from '@vultisig/core-chain/Chain'
import { getChainKind, type ChainKind } from '@vultisig/core-chain/ChainKind'

import { signingInputClasses } from './core'
import { signingInputResolversByChainKind } from './index'

describe('ChainKind signing-input alignment', () => {
  it('resolver map keys match signingInputClasses keys', () => {
    const a = Object.keys(signingInputResolversByChainKind).sort() as ChainKind[]
    const b = Object.keys(signingInputClasses).sort() as ChainKind[]
    expect(a).toEqual(b)
  })

  it('every Chain enum value has a resolver and encoder entry', () => {
    const kindsFromChains = new Set((Object.values(Chain) as ChainValue[]).map(chain => getChainKind(chain)))
    const kindsFromRegistry = new Set(Object.keys(signingInputResolversByChainKind) as ChainKind[])
    expect(kindsFromRegistry).toEqual(kindsFromChains)
  })
})

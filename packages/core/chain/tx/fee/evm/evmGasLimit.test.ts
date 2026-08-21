import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { deriveEvmGasLimit } from './evmGasLimit'

const mantleCoin = {
  chain: EvmChain.Mantle,
  address: '0x1111111111111111111111111111111111111111',
}
const mantleTokenCoin = {
  ...mantleCoin,
  id: '0x2222222222222222222222222222222222222222',
}

// sdk#1847: the old floor was 90_000_000n, ~4300x a real Mantle transfer's actual gas usage
// (~21,000) - real mainnet senders set 400,000-900,000. capGasLimit (getEvmFeeQuote.ts)
// takes bigIntMax(estimated, thirdParty, this floor), so the floor only matters when no
// higher live estimate is available - it must be a SANE safety net, not a strand-funds trap.
describe('deriveEvmGasLimit — Mantle native floor (sdk#1847)', () => {
  it('is in the real observed sender range (400,000-900,000), not the old 90,000,000n floor', () => {
    const limit = deriveEvmGasLimit({ coin: mantleCoin })
    expect(limit).toBeGreaterThanOrEqual(400_000n)
    expect(limit).toBeLessThanOrEqual(900_000n)
  })

  it('pins the exact new floor value', () => {
    expect(deriveEvmGasLimit({ coin: mantleCoin })).toBe(400_000n)
  })

  it('is dramatically lower than the old 90_000_000n floor (closes the ~6.75 MNT stranded-funds gap)', () => {
    const OLD_FLOOR = 90_000_000n
    const limit = deriveEvmGasLimit({ coin: mantleCoin })
    expect(limit).toBeLessThan(OLD_FLOOR)
    // Reduction factor sanity: at least 100x smaller (225x at the chosen value).
    expect(OLD_FLOOR / limit).toBeGreaterThanOrEqual(100n)
  })

  it('still comfortably covers real gas USED (~21,000) with generous headroom', () => {
    const REAL_GAS_USED = 21_000n
    const limit = deriveEvmGasLimit({ coin: mantleCoin })
    expect(limit).toBeGreaterThan(REAL_GAS_USED)
  })

  it('a memo-less Mantle token send (id set, no data) routes to the 3_000_000_000n data-bearing floor, not the 120_000n table default (sdk#1938 review)', () => {
    // chainSpecific/resolvers/evm.ts's getData() only carries swap calldata or an explicit
    // memo - a plain token send leaves `data` undefined even though it's a real ERC-20
    // `transfer(...)` call on-chain. deriveEvmGasLimit must not let that fall through to
    // erc20TransferGasLimit[Mantle] (120_000n) - a real Mantle token transfer needs gas in
    // the hundreds of millions (Mantle's op-geth fee model), so 120_000n would fail on-chain
    // and burn the fee.
    expect(deriveEvmGasLimit({ coin: mantleTokenCoin })).toBe(3_000_000_000n)
  })

  it('erc20TransferGasLimit[Mantle] table entry is unreachable in practice but still internally consistent', () => {
    // Structurally unreachable via deriveEvmGasLimit (the id && chain === Mantle branch
    // above catches every case that would otherwise land here), kept as a total Record entry.
    const nonMantleTokenCoin = { chain: EvmChain.Ethereum, address: mantleCoin.address, id: mantleTokenCoin.id }
    expect(deriveEvmGasLimit({ coin: nonMantleTokenCoin })).toBe(120_000n)
  })

  it('other EVM chains are unaffected by the Mantle-specific change', () => {
    const ethCoin = { chain: EvmChain.Ethereum, address: mantleCoin.address }
    expect(deriveEvmGasLimit({ coin: ethCoin })).toBe(23_000n)
  })
})

// The `data`-bearing branch (contract calls, ERC-20 transfers, swaps) is a SEPARATE
// hardcoded value NOT touched by sdk#1847 - pinned here so a future change to it is a
// conscious decision, not an accidental side effect of touching this file again.
describe('deriveEvmGasLimit — Mantle data-bearing floor (unchanged by sdk#1847, flagged separately)', () => {
  it('still returns the pre-existing 3_000_000_000n floor for a data-bearing Mantle call', () => {
    expect(deriveEvmGasLimit({ coin: mantleCoin, data: '0xabcdef' })).toBe(3_000_000_000n)
  })

  it('non-Mantle data-bearing calls are unaffected', () => {
    const ethCoin = { chain: EvmChain.Ethereum, address: mantleCoin.address }
    expect(deriveEvmGasLimit({ coin: ethCoin, data: '0xabcdef' })).toBe(600_000n)
  })
})

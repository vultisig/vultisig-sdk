import { describe, expect, it, vi } from 'vitest'

vi.mock('../../client', () => ({ getSolanaClient: vi.fn() }))

import { getSolanaClient } from '../../client'
import { kaminoVaultRegistry } from '../registry'
import { buildTestTransaction, depositInstructions, testOwner } from './__tests__/txTestKit'
import { kaminoAllowedPrograms, kaminoAttributionMemoTag, kaminoAttributionMemoTagBytes } from './instructions'
import {
  injectKaminoAttributionMemo,
  injectKaminoComputeBudget,
  isUnsignedSingleSigner,
  parseKaminoWireTransaction,
  refreshKaminoRecentBlockhash,
  resolveKaminoAccountAddresses,
  serializeKaminoWireTransaction,
  withKaminoRecentBlockhash,
} from './wire'

const [steakhouseUsdc] = kaminoVaultRegistry

const build = () =>
  buildTestTransaction({
    owner: testOwner,
    descriptor: steakhouseUsdc,
    instructions: depositInstructions(1_000_000n),
  })

describe('attribution memo literal', () => {
  it('pins the tag string and its exact bytes', () => {
    // The tag is the analytics key every downstream measurement filters on.
    // It must be byte-identical on every platform, so both the string and the
    // bytes are pinned — a drift in either is a build failure, not a tweak.
    expect(kaminoAttributionMemoTag).toBe('8k2mz')
    expect(Array.from(kaminoAttributionMemoTagBytes)).toEqual([0x38, 0x6b, 0x32, 0x6d, 0x7a])
  })
})

describe('injectKaminoAttributionMemo', () => {
  it('appends exactly one memo instruction with the tag and no accounts', () => {
    const { transaction } = build()
    const tagged = injectKaminoAttributionMemo(transaction)

    const instructions = tagged.message.compiledInstructions
    expect(instructions).toHaveLength(transaction.message.compiledInstructions.length + 1)

    const memo = instructions[instructions.length - 1]
    expect(Array.from(memo.data)).toEqual(Array.from(kaminoAttributionMemoTagBytes))
    expect(memo.accountKeyIndexes).toEqual([])
    expect(tagged.message.staticAccountKeys[memo.programIdIndex].toBase58()).toBe(kaminoAllowedPrograms.memo)
  })

  it('appends the program key to the read-only unsigned tail', () => {
    const { transaction } = build()
    const tagged = injectKaminoAttributionMemo(transaction)

    expect(tagged.message.staticAccountKeys.length).toBe(transaction.message.staticAccountKeys.length + 1)
    expect(tagged.message.staticAccountKeys.at(-1)?.toBase58()).toBe(kaminoAllowedPrograms.memo)
    expect(tagged.message.header.numReadonlyUnsignedAccounts).toBe(
      transaction.message.header.numReadonlyUnsignedAccounts + 1
    )
  })

  it('preserves every resolved account across the lookup-table index shift', () => {
    const { transaction, lookupTables } = build()
    const tagged = injectKaminoAttributionMemo(transaction)

    // The appended static key shifts every lookup-loaded index by one; the
    // accounts each original instruction addresses must not change.
    transaction.message.compiledInstructions.forEach((original, position) => {
      const before = original.accountKeyIndexes.map(
        index => resolveKaminoAccountAddresses({ transaction, lookupTables })![index]
      )
      const after = tagged.message.compiledInstructions[position].accountKeyIndexes.map(
        index => resolveKaminoAccountAddresses({ transaction: tagged, lookupTables })![index]
      )
      expect(after).toEqual(before)
    })
    expect(tagged.message.addressTableLookups).toEqual(transaction.message.addressTableLookups)
  })

  it('round-trips through serialization', () => {
    const { transaction } = build()
    const tagged = injectKaminoAttributionMemo(transaction)

    const revived = parseKaminoWireTransaction(serializeKaminoWireTransaction(tagged))
    expect(revived).toBeDefined()
    expect(serializeKaminoWireTransaction(revived!)).toBe(serializeKaminoWireTransaction(tagged))
  })

  it('refuses to append a second attribution', () => {
    const { transaction } = build()
    const tagged = injectKaminoAttributionMemo(transaction)
    expect(() => injectKaminoAttributionMemo(tagged)).toThrow('attribution memo already present')
  })
})

describe('injectKaminoComputeBudget', () => {
  it('prepends the pair and keeps the memo appendable after it', () => {
    const { transaction, lookupTables } = build()
    const withFee = injectKaminoComputeBudget({
      transaction,
      unitLimit: 320_000,
      unitPriceMicroLamports: 20_000n,
    })
    const complete = injectKaminoAttributionMemo(withFee)

    const instructions = complete.message.compiledInstructions
    expect(instructions).toHaveLength(transaction.message.compiledInstructions.length + 3)
    expect(complete.message.staticAccountKeys[instructions[0].programIdIndex].toBase58()).toBe(
      kaminoAllowedPrograms.computeBudget
    )
    expect(complete.message.staticAccountKeys[instructions[1].programIdIndex].toBase58()).toBe(
      kaminoAllowedPrograms.computeBudget
    )

    // Two successive injections, two index shifts — the original instructions
    // must still address the same resolved accounts.
    const resolved = resolveKaminoAccountAddresses({ transaction: complete, lookupTables })!
    const deposit = instructions[2]
    expect(resolved[deposit.accountKeyIndexes[0]]).toBe(testOwner)
    expect(resolved[deposit.accountKeyIndexes[1]]).toBe(steakhouseUsdc.address)
  })

  it('refuses a transaction that already carries a compute budget', () => {
    const { transaction } = build()
    const withFee = injectKaminoComputeBudget({ transaction, unitLimit: 1, unitPriceMicroLamports: 1n })
    expect(() => injectKaminoComputeBudget({ transaction: withFee, unitLimit: 1, unitPriceMicroLamports: 1n })).toThrow(
      'compute budget already present'
    )
  })
})

describe('withKaminoRecentBlockhash', () => {
  it('replaces the blockhash and nothing else', () => {
    const { transaction } = build()
    const fresh = 'GfVcyD5xVDkzvhLxRpnif71yijvbqrgHDpUkeGnvJ3VE'

    const refreshed = withKaminoRecentBlockhash({ transaction, recentBlockhash: fresh })

    expect(refreshed.message.recentBlockhash).toBe(fresh)
    expect(refreshed.message.compiledInstructions).toEqual(transaction.message.compiledInstructions)
    expect(refreshed.message.staticAccountKeys).toEqual(transaction.message.staticAccountKeys)
    expect(refreshed.message.addressTableLookups).toEqual(transaction.message.addressTableLookups)
  })

  it('fetches the fresh blockhash from the RPC immediately before keysign', async () => {
    const { transaction } = build()
    const fresh = 'GfVcyD5xVDkzvhLxRpnif71yijvbqrgHDpUkeGnvJ3VE'
    vi.mocked(getSolanaClient).mockReturnValue({
      getLatestBlockhash: async () => ({ blockhash: fresh }),
    } as never)

    const refreshed = await refreshKaminoRecentBlockhash(transaction)

    expect(refreshed.message.recentBlockhash).toBe(fresh)
  })
})

describe('isUnsignedSingleSigner', () => {
  it('accepts the placeholder-signed single-signer shape', () => {
    const { transaction } = build()
    expect(isUnsignedSingleSigner(transaction, testOwner)).toBe(true)
  })

  it('refuses a wrong fee payer and a filled signature', () => {
    const { transaction } = build()
    expect(isUnsignedSingleSigner(transaction, steakhouseUsdc.address)).toBe(false)

    transaction.signatures[0][0] = 1
    expect(isUnsignedSingleSigner(transaction, testOwner)).toBe(false)
  })
})

describe('parseKaminoWireTransaction', () => {
  it('refuses bytes that are not a v0 transaction', () => {
    expect(parseKaminoWireTransaction('not-base64!!')).toBeUndefined()
    expect(parseKaminoWireTransaction(Buffer.from([1, 2, 3]).toString('base64'))).toBeUndefined()
  })
})

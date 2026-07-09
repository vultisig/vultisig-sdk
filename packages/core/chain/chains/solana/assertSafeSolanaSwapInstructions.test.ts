import { AddressLookupTableAccount, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import jupiterSwapFixtures from '../../fixtures/jupiter-swap-transactions.json'
import { assertSafeSolanaSwapInstructions, UnsafeSolanaSwapInstructionError } from './assertSafeSolanaSwapInstructions'

type Fixture = {
  description: string
  swapTransaction: string
  lookupTables: { key: string; dataBase64: string }[]
}

const fixtures = jupiterSwapFixtures as unknown as Record<string, Fixture>

const decodeFixture = (fixture: Fixture) => {
  const versionedTx = VersionedTransaction.deserialize(Buffer.from(fixture.swapTransaction, 'base64'))
  const lutAccounts = fixture.lookupTables.map(
    lut =>
      new AddressLookupTableAccount({
        key: new PublicKey(lut.key),
        state: AddressLookupTableAccount.deserialize(Buffer.from(lut.dataBase64, 'base64')),
      })
  )
  return { versionedTx, lutAccounts }
}

describe('assertSafeSolanaSwapInstructions', () => {
  // (a) captured real Jupiter VersionedTransaction -> passes
  it('passes a real captured single-hop Jupiter swap (SOL -> USDC)', () => {
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.singleHopSolToUsdc)
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)).not.toThrow()
  })

  it('passes a real captured 3-hop Jupiter swap (SOL -> BONK)', () => {
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.multiHopSolToBonk)
    expect(versionedTx.message.version).toBe(0)
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)).not.toThrow()
  })

  // (b) same with one program swapped to a foreign pubkey -> throws
  it('throws SOL_SWAP_UNEXPECTED_PROGRAM when a top-level instruction targets a foreign program', () => {
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.singleHopSolToUsdc)

    // Swap the Jupiter router's STATIC account-key entry for an
    // attacker-controlled pubkey - simulating a compromised proxy splicing a
    // drain instruction's program in place of the router.
    const jupiterRouterIndex = versionedTx.message.staticAccountKeys.findIndex(
      key => key.toBase58() === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
    )
    expect(jupiterRouterIndex).toBeGreaterThanOrEqual(0)

    const maliciousProgramId = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    versionedTx.message.staticAccountKeys[jupiterRouterIndex] = maliciousProgramId

    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)).toThrow(
      UnsafeSolanaSwapInstructionError
    )
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)).toThrow(
      /SOL_SWAP_UNEXPECTED_PROGRAM/
    )
  })

  it('does not throw a false-positive on a benign account substitution elsewhere in the fixture', () => {
    // Sanity check the previous test is actually exercising the guard and not
    // just throwing on any mutation: swapping a NON-program account key
    // (e.g. the payer) must NOT trip the guard.
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.singleHopSolToUsdc)
    const payerIndex = 0
    versionedTx.message.staticAccountKeys[payerIndex] = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)).not.toThrow()
  })

  // (c) v0 ALT-resolved keys handled
  describe('v0 address-lookup-table resolution', () => {
    const payerKey = new PublicKey('5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB')
    const lutKey = new PublicKey('CRz7ucCE6ZFhN297AC56ihUBbdDuZNzN3D7MVw2cYPna')
    const systemProgramId = new PublicKey('11111111111111111111111111111111')
    const maliciousProgramId = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')

    const buildMessage = (resolvedProgramId: PublicKey) => {
      const lutAccount = new AddressLookupTableAccount({
        key: lutKey,
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: [resolvedProgramId],
        },
      })

      // A single static key (the payer) plus one instruction whose
      // programIdIndex (1) points PAST the static keys into the ALT-resolved
      // region - i.e. the program itself is only knowable by resolving the
      // lookup table, exactly like a real Jupiter v0 message compacts
      // frequently-reused accounts.
      const message = new MessageV0({
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
        staticAccountKeys: [payerKey],
        recentBlockhash: '11111111111111111111111111111111111111111111',
        compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [], data: new Uint8Array() }],
        addressTableLookups: [{ accountKey: lutKey, writableIndexes: [], readonlyIndexes: [0] }],
      })

      return { message, lutAccount }
    }

    it('resolves an ALT-backed program index to an allow-listed program and passes', () => {
      const { message, lutAccount } = buildMessage(systemProgramId)
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount])).not.toThrow()
    })

    it('resolves an ALT-backed program index to a foreign program and throws', () => {
      const { message, lutAccount } = buildMessage(maliciousProgramId)
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount])).toThrow(UnsafeSolanaSwapInstructionError)
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount])).toThrow(/SOL_SWAP_UNEXPECTED_PROGRAM/)
    })

    it('throws (fail-safe) when the referenced lookup table is missing entirely', () => {
      // web3.js's own getAccountKeys() refuses to resolve when a referenced
      // LUT isn't supplied, before our allow-list check even runs - still
      // fail-safe (never silently treats an unresolvable index as safe).
      const { message } = buildMessage(systemProgramId)
      expect(() => assertSafeSolanaSwapInstructions(message, [])).toThrow(/address lookup table/i)
    })
  })
})

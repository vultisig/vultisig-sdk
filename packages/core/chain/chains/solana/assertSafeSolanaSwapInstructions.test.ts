import { AddressLookupTableAccount, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import jupiterSwapFixtures from '../../fixtures/jupiter-swap-transactions.json'
import {
  assertSafeSolanaSwapInstructions,
  UnsafeSolanaSwapFundMovementError,
  UnsafeSolanaSwapInstructionError,
} from './assertSafeSolanaSwapInstructions'

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
    const userWallet = versionedTx.message.staticAccountKeys[0]!
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, userWallet)).not.toThrow()
  })

  it('passes a real captured 3-hop Jupiter swap (SOL -> BONK)', () => {
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.multiHopSolToBonk)
    const userWallet = versionedTx.message.staticAccountKeys[0]!
    expect(versionedTx.message.version).toBe(0)
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, userWallet)).not.toThrow()
  })

  // (b) same with one program swapped to a foreign pubkey -> throws
  it('throws SOL_SWAP_UNEXPECTED_PROGRAM when a top-level instruction targets a foreign program', () => {
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.singleHopSolToUsdc)
    const userWallet = versionedTx.message.staticAccountKeys[0]!

    // Swap the Jupiter router's STATIC account-key entry for an
    // attacker-controlled pubkey - simulating a compromised proxy splicing a
    // drain instruction's program in place of the router.
    const jupiterRouterIndex = versionedTx.message.staticAccountKeys.findIndex(
      key => key.toBase58() === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
    )
    expect(jupiterRouterIndex).toBeGreaterThanOrEqual(0)

    const maliciousProgramId = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    versionedTx.message.staticAccountKeys[jupiterRouterIndex] = maliciousProgramId

    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, userWallet)).toThrow(
      UnsafeSolanaSwapInstructionError
    )
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, userWallet)).toThrow(
      /SOL_SWAP_UNEXPECTED_PROGRAM/
    )
  })

  it('rejects when the payer slot (also used as CloseAccount destination) is substituted with an attacker pubkey', () => {
    // In the real SOL->USDC Jupiter fixture, staticAccountKeys[0] (the payer)
    // is also the destination in the wSOL Token.CloseAccount (unwrap) instruction —
    // the unwrapped SOL/rent returns to the user. Substituting it with an attacker
    // pubkey in the raw message bytes while keeping the real user wallet as the
    // guard's reference correctly trips the layer-2 destination check — the test
    // doubles as a regression test for a compromised proxy modifying the account
    // table without touching the program list.
    const { versionedTx, lutAccounts } = decodeFixture(fixtures.singleHopSolToUsdc)
    const originalUserWallet = versionedTx.message.staticAccountKeys[0]!
    versionedTx.message.staticAccountKeys[0] = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, originalUserWallet)).toThrow(
      UnsafeSolanaSwapFundMovementError
    )
    expect(() => assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, originalUserWallet)).toThrow(
      /CloseAccount destination/
    )
  })

  it('does not throw a false-positive on an account substitution in a non-fund-moving instruction', () => {
    // Sanity check: swapping an account that ONLY appears as an argument to the
    // Jupiter router (not a fund-moving program) must NOT trip either guard.
    // Uses a synthetic fixture so the account layout is fully controlled.
    const jupiterRouter = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
    const originalPayer = new PublicKey('5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB')
    const message = new MessageV0({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [originalPayer, jupiterRouter],
      recentBlockhash: '11111111111111111111111111111111111111111111',
      compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0], data: new Uint8Array(0) }],
      addressTableLookups: [],
    })
    // Substitute the payer slot with an attacker pubkey
    message.staticAccountKeys[0] = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    // The program is JUP6 (allow-listed, not a fund-moving program) - no fund-movement
    // decode fires, so this passes both layers.
    expect(() => assertSafeSolanaSwapInstructions(message, [], originalPayer)).not.toThrow()
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
      // data is empty -> fund-moving validation is a no-op for this synthetic fixture
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount], payerKey)).not.toThrow()
    })

    it('resolves an ALT-backed program index to a foreign program and throws', () => {
      const { message, lutAccount } = buildMessage(maliciousProgramId)
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount], payerKey)).toThrow(
        UnsafeSolanaSwapInstructionError
      )
      expect(() => assertSafeSolanaSwapInstructions(message, [lutAccount], payerKey)).toThrow(
        /SOL_SWAP_UNEXPECTED_PROGRAM/
      )
    })

    it('throws (fail-safe) when the referenced lookup table is missing entirely', () => {
      // web3.js's own getAccountKeys() refuses to resolve when a referenced
      // LUT isn't supplied, before our allow-list check even runs - still
      // fail-safe (never silently treats an unresolvable index as safe).
      const { message } = buildMessage(systemProgramId)
      expect(() => assertSafeSolanaSwapInstructions(message, [], payerKey)).toThrow(/address lookup table/i)
    })
  })

  // (d) fund-movement drain-injection tests (audit finding SOL-01 layer 2)
  describe('drain-injection prevention', () => {
    const userWallet = new PublicKey('5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB')
    const attacker = new PublicKey('Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi')
    const systemProgramId = new PublicKey('11111111111111111111111111111111')
    const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

    const buildSystemTransfer = (from: PublicKey, to: PublicKey): MessageV0 => {
      // SystemProgram.Transfer instruction data: u32LE discriminant=2 + u64LE lamports
      const data = new Uint8Array(12)
      new DataView(data.buffer).setUint32(0, 2, true) // type=Transfer
      new DataView(data.buffer).setBigUint64(4, 1_000_000n, true) // 1 SOL
      return new MessageV0({
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
        staticAccountKeys: [from, to, systemProgramId],
        recentBlockhash: '11111111111111111111111111111111111111111111',
        compiledInstructions: [{ programIdIndex: 2, accountKeyIndexes: [0, 1], data }],
        addressTableLookups: [],
      })
    }

    const buildTokenInstruction = (discriminant: number, accounts: PublicKey[]): MessageV0 => {
      const data = new Uint8Array([discriminant])
      const staticAccountKeys = [...accounts, tokenProgramId]
      return new MessageV0({
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
        staticAccountKeys,
        recentBlockhash: '11111111111111111111111111111111111111111111',
        compiledInstructions: [
          {
            programIdIndex: staticAccountKeys.length - 1,
            accountKeyIndexes: accounts.map((_, i) => i),
            data,
          },
        ],
        addressTableLookups: [],
      })
    }

    it('rejects a SystemProgram.Transfer draining SOL to an attacker address', () => {
      const msg = buildSystemTransfer(userWallet, attacker)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/SOL_SWAP_UNSAFE_FUND_MOVEMENT/)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/SystemProgram\.Transfer destination/)
    })

    it('rejects Token.Approve (type=4) regardless of accounts', () => {
      // Token.Approve: accounts[0]=source, accounts[1]=delegate, accounts[2]=owner
      const msg = buildTokenInstruction(4, [userWallet, attacker, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.Approve/)
    })

    it('rejects Token.ApproveChecked (type=13) regardless of accounts', () => {
      const msg = buildTokenInstruction(13, [userWallet, userWallet, attacker, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.ApproveChecked/)
    })

    it('rejects Token.SetAuthority (type=6) regardless of accounts', () => {
      const msg = buildTokenInstruction(6, [userWallet, attacker])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.SetAuthority/)
    })

    it('rejects Token.Transfer (type=3) outright — even with authority==user, destination==attacker (real drain shape)', () => {
      // The real drain: authority is definitionally the user (their tokens can only
      // move if they sign), but destination points to the attacker. Validating
      // authority==user would PASS this. We reject Token.Transfer top-level entirely.
      // accounts[0]=source, accounts[1]=destination(attacker), accounts[2]=authority(user)
      const msg = buildTokenInstruction(3, [userWallet, attacker, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.Transfer/)
    })

    it('rejects Token.TransferChecked (type=12) outright — even with authority==user, destination==attacker (real drain shape)', () => {
      // accounts[0]=source, accounts[1]=mint, accounts[2]=destination(attacker), accounts[3]=authority(user)
      const msg = buildTokenInstruction(12, [userWallet, userWallet, attacker, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.TransferChecked/)
    })

    it('rejects Token.CloseAccount (type=9) where destination is not the user wallet', () => {
      // Real drain: authority==user (required), but destination (accounts[1]) points
      // to attacker — closes the user's wSOL ATA and sends rent+SOL to attacker.
      // accounts[0]=account, accounts[1]=destination(attacker), accounts[2]=authority(user)
      const msg = buildTokenInstruction(9, [userWallet, attacker, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(UnsafeSolanaSwapFundMovementError)
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).toThrow(/Token\.CloseAccount destination/)
    })

    it('allows Token.CloseAccount (type=9) where destination IS the user wallet', () => {
      // Legit: wSOL unwrap where rent/SOL returns to the user
      // accounts[0]=wSOL ATA, accounts[1]=destination(user), accounts[2]=authority(user)
      const msg = buildTokenInstruction(9, [userWallet, userWallet, userWallet])
      expect(() => assertSafeSolanaSwapInstructions(msg, [], userWallet)).not.toThrow()
    })
  })
})

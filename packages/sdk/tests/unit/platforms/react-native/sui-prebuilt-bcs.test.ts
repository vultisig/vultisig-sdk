/**
 * architecture#1993 — prebuilt Sui sender-pin, ported from vultiagent-app.
 *
 * `extractSuiPrebuiltSender` / `assertSuiPrebuiltSenderMatchesVault` walk the
 * real Sui `TransactionData` BCS layout (kind → sender → gasData →
 * expiration) to pull `sender` out from behind the variable-length
 * `ProgrammableTransaction` body, then bind it to the expected address
 * before a prebuilt-signing consumer blind-signs.
 *
 * Fixtures below are REAL BCS bytes produced by `@mysten/sui`'s own
 * `TransactionData` schema (the same library upstream prebuilt-tx builders
 * use) — not hand-guessed byte layouts. Two shapes are covered:
 *   - a simple SplitCoins + TransferObjects PTB (CallArg::Pure, CallArg::Object
 *     ImmOrOwnedObject, Argument::Input/Result)
 *   - a MoveCall + MakeMoveVec PTB exercising ObjectArg::SharedObject, nested
 *     TypeTag (struct + vector), and Argument::GasCoin/NestedResult
 *
 * Both prove the "walk past everything to reach sender" logic is byte-exact,
 * not just correct on an empty/trivial PTB.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  assertSuiPrebuiltSenderMatchesVault,
  extractSuiPrebuiltSender,
  testing,
} from '../../../../src/platforms/react-native/chains/sui/prebuiltBcs'

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// SplitCoins + TransferObjects PTB, sender = 0x1111...1111 (32 bytes of 0x11).
const SIMPLE_PTB_SENDER_A_HEX =
  '0000030008010000000000000001003333333333333333333333333333333333333333333333333333333333' +
  '3333330a0000000000000020ad2d5b61f5e2597e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e209' +
  '0020444444444444444444444444444444444444444444444444444444444444444402020101000101000001' +
  '0102000001020011111111111111111111111111111111111111111111111111111111111111110155555555' +
  '55555555555555555555555555555555555555555555555555555555140000000000000020ad2d5b61f5e259' +
  '7e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e20911111111111111111111111111111111111111' +
  '11111111111111111111111111e803000000000000c0c62d000000000000'
const SIMPLE_PTB_SENDER_A = hexToBytes(SIMPLE_PTB_SENDER_A_HEX)

// Byte-identical PTB body, sender swapped to 0x2222...2222 - the tampered case.
const SIMPLE_PTB_SENDER_B_HEX =
  '0000030008010000000000000001003333333333333333333333333333333333333333333333333333333333' +
  '3333330a0000000000000020ad2d5b61f5e2597e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e209' +
  '0020444444444444444444444444444444444444444444444444444444444444444402020101000101000001' +
  '0102000001020022222222222222222222222222222222222222222222222222222222222222220155555555' +
  '55555555555555555555555555555555555555555555555555555555140000000000000020ad2d5b61f5e259' +
  '7e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e20922222222222222222222222222222222222222' +
  '22222222222222222222222222e803000000000000c0c62d000000000000'
const SIMPLE_PTB_SENDER_B = hexToBytes(SIMPLE_PTB_SENDER_B_HEX)

// Same PTB as SIMPLE_PTB_SENDER_A, but the first Command's tag (offset 123)
// is corrupted from 0x02 (SplitCoins) to 0x63 - a Command variant that
// doesn't exist. Proves fail-closed covers "unrecognized structure", not just
// truncation.
const CORRUPTED_COMMAND_TAG_PTB_HEX =
  '0000030008010000000000000001003333333333333333333333333333333333333333333333333333333333' +
  '3333330a0000000000000020ad2d5b61f5e2597e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e209' +
  '0020444444444444444444444444444444444444444444444444444444444444444402630101000101000001' +
  '0102000001020011111111111111111111111111111111111111111111111111111111111111110155555555' +
  '55555555555555555555555555555555555555555555555555555555140000000000000020ad2d5b61f5e259' +
  '7e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e20911111111111111111111111111111111111111' +
  '11111111111111111111111111e803000000000000c0c62d000000000000'
const CORRUPTED_COMMAND_TAG_PTB = hexToBytes(CORRUPTED_COMMAND_TAG_PTB_HEX)

// MoveCall (pool::swap with struct + vector TypeTag args) + MakeMoveVec
// (Option<TypeTag>::Some), sender = 0x7777...7777. Also exercises
// ObjectArg::SharedObject and Argument::GasCoin/NestedResult.
const MOVECALL_PTB_SENDER_HEX =
  '000002010033333333333333333333333333333333333333333333333333333333333333330a000000000000' +
  '0020ad2d5b61f5e2597e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e20901016666666666666666' +
  '6666666666666666666666666666666666666666666666660500000000000000010200999999999999999999' +
  '999999999999999999999999999999999999999999999904706f6f6c04737761700207999999999999999999' +
  '9999999999999999999999999999999999999999999999047573646304555344430006020300010000010100' +
  '0501010202000003000001007777777777777777777777777777777777777777777777777777777777777777' +
  '015555555555555555555555555555555555555555555555555555555555555555140000000000000020ad2d' +
  '5b61f5e2597e313a5c194988455d092b0f302af7e8a80bdb3a2f3eb5e2097777777777777777777777777777' +
  '777777777777777777777777777777777777e803000000000000c0c62d000000000000'
const MOVECALL_PTB_SENDER = hexToBytes(MOVECALL_PTB_SENDER_HEX)

describe('extractSuiPrebuiltSender', () => {
  it('decodes the sender out of a simple SplitCoins/TransferObjects PTB', () => {
    expect(extractSuiPrebuiltSender(SIMPLE_PTB_SENDER_A)).toBe(`0x${'11'.repeat(32)}`)
  })

  it('decodes the sender out of a MoveCall/MakeMoveVec PTB (nested TypeTag, SharedObject)', () => {
    expect(extractSuiPrebuiltSender(MOVECALL_PTB_SENDER)).toBe(`0x${'77'.repeat(32)}`)
  })

  it('throws on a truncated buffer', () => {
    expect(() => extractSuiPrebuiltSender(SIMPLE_PTB_SENDER_A.slice(0, 50))).toThrow()
  })

  it('throws on an unrecognized Command variant tag', () => {
    expect(() => extractSuiPrebuiltSender(CORRUPTED_COMMAND_TAG_PTB)).toThrow(/unknown Command variant/)
  })
})

describe('assertSuiPrebuiltSenderMatchesVault', () => {
  it('PASSES when the decoded sender matches the expected address (legit prebuilt tx)', () => {
    expect(() => assertSuiPrebuiltSenderMatchesVault(SIMPLE_PTB_SENDER_A, `0x${'11'.repeat(32)}`)).not.toThrow()
  })

  it('PASSES case-insensitively', () => {
    expect(() =>
      assertSuiPrebuiltSenderMatchesVault(SIMPLE_PTB_SENDER_A, `0x${'11'.repeat(32)}`.toUpperCase())
    ).not.toThrow()
  })

  it('REJECTS when the decoded sender does not match the expected address (hostile/mismatched backend PTB)', () => {
    expect(() => assertSuiPrebuiltSenderMatchesVault(SIMPLE_PTB_SENDER_B, `0x${'11'.repeat(32)}`)).toThrow(
      /does not match the expected address/
    )
  })

  it('REJECTS a MoveCall PTB whose sender differs from the expected address', () => {
    expect(() => assertSuiPrebuiltSenderMatchesVault(MOVECALL_PTB_SENDER, `0x${'11'.repeat(32)}`)).toThrow(
      /does not match the expected address/
    )
  })

  it('FAILS CLOSED (throws) on a truncated/malformed buffer instead of skipping the bind', () => {
    expect(() => assertSuiPrebuiltSenderMatchesVault(SIMPLE_PTB_SENDER_A.slice(0, 50), `0x${'11'.repeat(32)}`)).toThrow(
      /could not verify the sender/
    )
  })

  it('FAILS CLOSED (throws) on an unrecognized Command variant (decode drift), even with a matching expected address', () => {
    // Undecodable bytes must refuse the send regardless of whether the
    // (unreachable) sender would have matched - the point is we genuinely
    // can't tell, so signing is never safe.
    expect(() => assertSuiPrebuiltSenderMatchesVault(CORRUPTED_COMMAND_TAG_PTB, `0x${'11'.repeat(32)}`)).toThrow(
      /could not verify the sender/
    )
  })

  it('LOGS an error when it fails closed, so the refusal is greppable', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() =>
        assertSuiPrebuiltSenderMatchesVault(SIMPLE_PTB_SENDER_A.slice(0, 50), `0x${'11'.repeat(32)}`)
      ).toThrow()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('sender bind FAILED'))
    } finally {
      error.mockRestore()
    }
  })
})

describe('readUleb128 32-bit range', () => {
  const { BcsCursor } = testing

  // A bitwise accumulator (`result |= (byte & 0x7f) << shift`) coerces to
  // int32, so these SILENTLY TRUNCATE instead of throwing: a length prefix
  // collapsing to a small value would walk off-schema and read 32
  // attacker-placed bytes as `sender`. These bytes are not network-valid (the
  // Rust `bcs` decoder caps vector lengths at u32), so this is a contract bug
  // rather than a live bypass - but "exceeds 32 bits" must actually throw.
  it.each([
    ['2^32 (truncates to 0 under a bitwise accumulator)', [0x80, 0x80, 0x80, 0x80, 0x10]],
    ['2^32+1 (truncates to 1)', [0x81, 0x80, 0x80, 0x80, 0x10]],
    ['0x7f0000005 (truncates to 0xf0000005)', [0x85, 0x80, 0x80, 0x80, 0x7f]],
  ])('throws on an out-of-u32-range uleb128: %s', (_label, bytes) => {
    const c = new BcsCursor(Uint8Array.from(bytes))
    expect(() => c.readUleb128()).toThrow(/exceeds 32 bits/)
  })

  it('still accepts the full u32 range (0xffffffff)', () => {
    const c = new BcsCursor(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x0f]))
    expect(c.readUleb128()).toBe(0xffffffff)
  })
})

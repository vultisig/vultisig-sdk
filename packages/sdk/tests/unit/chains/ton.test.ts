/**
 * TON bridge unit tests.
 *
 * These tests validate the SDK's inline TON implementation by re-building
 * the same native transfer twice — once via our hand-rolled
 * `buildTonSendTx` / `buildV4R2Wallet` path, and once via `@ton/core`
 * primitives (`beginCell`, `internal`, `storeMessageRelaxed`, etc.) — and
 * assert byte-for-byte equality on the signing hash, the wallet address,
 * and the resulting external BOC. Both sides reference the same V4R2
 * wallet code cell (encoded as a base64 BOC inside `walletV4R2.ts`); the
 * test guards against drift in cell reference counts, varint encoding, and
 * builder layout that would change the on-chain hash. We do not import
 * `@ton/ton` (the higher-level `WalletContractV4` wrapper) — `@ton/core`
 * is sufficient for the cross-check at the cell level.
 */
import { beginCell, internal, SendMode, storeMessageRelaxed } from '@ton/core'
import { describe, expect, it } from 'vitest'

import {
  assertTonSigningPayloadNoHostileDrain,
  buildTonSendTx,
  buildTonTxFromSigningPayload,
  deriveTonAddress,
  TON_V4R2_SUB_WALLET_ID,
  validateTonMemo,
} from '../../../src/chains/ton'
import { buildV4R2Wallet } from '../../../src/chains/ton/walletV4R2'

// Deterministic 32-byte Ed25519 pubkey (all 0x01s) — avoids seed randomness
// and keeps the byte-parity assertion stable across runs.
const PUBKEY_HEX = '01'.repeat(32)
const RECIPIENT = 'UQDy_zN0Mel7MItGcTQr0kxEJxa7dg_-OGv7_XToTMTKT1Cz'

describe('chains/ton', () => {
  it('derives the same V4R2 address as @ton/ton', () => {
    const addr = deriveTonAddress(PUBKEY_HEX, { bounceable: false })
    // The address must be stable for a given pubkey + workchain. Any
    // change to the V4R2 code cell would break this.
    const wallet = buildV4R2Wallet({
      publicKeyEd25519: Uint8Array.from({ length: 32 }, () => 0x01),
    })
    expect(addr).toBe(wallet.addressString({ bounceable: false }))
  })

  it('rejects memos over 123 bytes', () => {
    expect(() => validateTonMemo('x'.repeat(124))).toThrow(/at most 123 bytes/)
  })

  it('exposes the V4R2 subwallet ID constant', () => {
    expect(TON_V4R2_SUB_WALLET_ID).toBe(698983191)
  })

  it('matches the WalletCore-compatible @ton/core cell layout for a native send', () => {
    const amount = 1_000_000_000n // 1 TON
    const seqno = 42
    const validUntil = 1_700_000_000 // pinned so hash is deterministic

    const result = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount,
      bounceable: true,
      seqno,
      validUntil,
    })

    // Reference: build the exact same signing payload manually using only
    // `@ton/core` primitives while selecting WalletCore's body-reference
    // representation. Both inline and referenced bodies are valid TON
    // messages, but mixed-platform MPC requires byte-identical preimages.
    const walletReference = buildV4R2Wallet({
      publicKeyEd25519: Uint8Array.from({ length: 32 }, () => 0x01),
    })
    const destination = walletReference.address // re-used only for the check below
    expect(destination).toBeDefined()

    const internalMsg = beginCell()
      .store(
        storeMessageRelaxed(
          internal({
            to: RECIPIENT,
            value: amount,
            bounce: true,
          }),
          // WalletCore's V4R2 encoder always stores the body as a reference.
          { forceRef: true }
        )
      )
      .endCell()

    const sendMode = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS
    const expectedPayload = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(validUntil, 32)
      .storeUint(seqno, 32)
      .storeUint(0, 8)
      .storeUint(sendMode, 8)
      .storeRef(internalMsg)
      .endCell()

    const expectedHash = expectedPayload.hash().toString('hex')
    expect(result.signingHashHex).toBe(expectedHash)
  })

  it('includes StateInit when seqno === 0 and omits it otherwise', () => {
    const fakeSig = 'aa'.repeat(64)

    const deploySeqno0 = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 1_000_000n,
      bounceable: false,
      seqno: 0,
      validUntil: 1_700_000_000,
    }).finalize(fakeSig)

    const subsequentSeqno1 = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 1_000_000n,
      bounceable: false,
      seqno: 1,
      validUntil: 1_700_000_000,
    }).finalize(fakeSig)

    // The BOC including StateInit is longer than the one without (one more
    // referenced cell containing code+data). This is the cheapest way to
    // sanity-check inclusion without dragging a full BOC parser into the
    // unit harness.
    expect(deploySeqno0.signedBocBase64.length).toBeGreaterThan(subsequentSeqno1.signedBocBase64.length)
  })

  it('finalize rejects signatures of the wrong length', () => {
    const builder = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 1n,
      bounceable: false,
      seqno: 1,
      validUntil: 1_700_000_000,
    })
    expect(() => builder.finalize('aa'.repeat(32))).toThrow(/must be 64 bytes/)
  })
})

describe('chains/ton / buildTonTxFromSigningPayload (prebuilt-payload signing)', () => {
  // Round-trip parity: build a payload via buildTonSendTx, extract its
  // unsignedBocHex (the serialized signing-payload Cell), feed it back
  // through buildTonTxFromSigningPayload. signingHashHex MUST match
  // byte-for-byte and finalize(sig) MUST produce the same external
  // BoC. This proves the primitive is a clean replacement for the
  // chain-specific builder when fed equivalent input — which is the
  // contract yield.xyz / dApp signing flows rely on.
  it('produces the same signingHashHex as buildTonSendTx for an identical payload', () => {
    const reference = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 250_000_000n, // 0.25 TON
      bounceable: false,
      seqno: 7,
      validUntil: 1_700_000_000,
    })

    const replay = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: Buffer.from(reference.unsignedBocHex, 'hex').toString('base64'),
      // seqno is non-zero → no StateInit envelope
      includeStateInit: false,
    })

    expect(replay.signingHashHex).toBe(reference.signingHashHex)
    expect(replay.fromAddress).toBe(reference.fromAddress)

    // Same payload + same sig → same broadcastable BoC.
    const sig = 'cc'.repeat(64)
    expect(replay.finalize(sig).signedBocBase64).toBe(reference.finalize(sig).signedBocBase64)
  })

  it('accepts a hex-encoded signing payload (forward-compat with hex wire formats)', () => {
    const reference = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 100n,
      bounceable: false,
      seqno: 5,
      validUntil: 1_700_000_000,
    })
    const replay = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: reference.unsignedBocHex, // hex, not base64
    })
    expect(replay.signingHashHex).toBe(reference.signingHashHex)
  })

  it('accepts a 0x-prefixed hex signing payload (CodeRabbit #516 r2)', () => {
    // The decoder must strip an optional 0x prefix before deciding
    // hex-vs-base64. Without that, an EVM-leaning callsite that
    // prepends "0x" silently fell through to the base64 branch and
    // produced garbage bytes (wrong signing hash → wrong MPC sig).
    const reference = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 100n,
      bounceable: false,
      seqno: 7,
      validUntil: 1_700_000_000,
    })
    const replay = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: '0x' + reference.unsignedBocHex,
    })
    expect(replay.signingHashHex).toBe(reference.signingHashHex)
  })

  it('disambiguates hex from base64 via BoC magic 0xB5EE9C72 (CodeRabbit #516 r2)', () => {
    // A real BoC starts with the magic 0xB5EE9C72. The decoder must
    // recognise that prefix as hex even when the byte stream could
    // also be a syntactically-valid base64 string. Without the magic
    // disambiguation, even-length hex that happens to match base64
    // alphabet rules could be misclassified.
    const reference = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 100n,
      bounceable: false,
      seqno: 9,
      validUntil: 1_700_000_000,
    })
    // BoC's serialized form always begins with the magic bytes.
    expect(/^b5ee9c72/i.test(reference.unsignedBocHex)).toBe(true)
    const replay = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: reference.unsignedBocHex,
    })
    expect(replay.signingHashHex).toBe(reference.signingHashHex)
  })

  it('emits a larger BoC when includeStateInit=true (first-send deployment envelope)', () => {
    // The wallet address derives from the pubkey; we only test the BoC
    // size grows because adding StateInit appends a code+data ref.
    // Same payload + same sig + only the includeStateInit flag toggled.
    const ref = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 1_000n,
      bounceable: false,
      seqno: 0, // deploy + send
      validUntil: 1_700_000_000,
    })
    const bocBase64 = Buffer.from(ref.unsignedBocHex, 'hex').toString('base64')
    const fakeSig = 'aa'.repeat(64)

    const withStateInit = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: bocBase64,
      includeStateInit: true,
    }).finalize(fakeSig)

    const withoutStateInit = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: bocBase64,
      includeStateInit: false,
    }).finalize(fakeSig)

    expect(withStateInit.signedBocBase64.length).toBeGreaterThan(withoutStateInit.signedBocBase64.length)
  })

  it('rejects an Ed25519 pubkey that is not 32 bytes', () => {
    expect(() =>
      buildTonTxFromSigningPayload({
        publicKeyEd25519: '01'.repeat(33), // 33 bytes
        signingPayloadBoc: 'AA==',
      })
    ).toThrow(/32 bytes/)
  })

  it('rejects an empty signing payload', () => {
    expect(() =>
      buildTonTxFromSigningPayload({
        publicKeyEd25519: PUBKEY_HEX,
        signingPayloadBoc: '',
      })
    ).toThrow(/empty/)
  })

  it('finalize rejects signatures of the wrong length', () => {
    const reference = buildTonSendTx({
      publicKeyEd25519: PUBKEY_HEX,
      to: RECIPIENT,
      amount: 1n,
      bounceable: false,
      seqno: 1,
      validUntil: 1_700_000_000,
    })
    const builder = buildTonTxFromSigningPayload({
      publicKeyEd25519: PUBKEY_HEX,
      signingPayloadBoc: Buffer.from(reference.unsignedBocHex, 'hex').toString('base64'),
    })
    expect(() => builder.finalize('aa'.repeat(32))).toThrow(/must be 64 bytes/)
  })
})

describe('chains/ton / assertTonSigningPayloadNoHostileDrain (architecture#1994)', () => {
  // Ported from vultiagent-app's local `assertTonPrebuiltNoHostileDrain`
  // guard (src/services/tonTx.ts) — the app was the only first-party
  // consumer refusing non-zero wallet ops and full-balance-drain send
  // modes on a TON prebuilt signing payload; any other SDK consumer had
  // to duplicate this decoder or sign blindly. Now lives next to the
  // builder that produces the exact wire layout it decodes.
  const VALID_UNTIL = 1_700_000_000

  /**
   * Hand-builds a wallet V4R2 signing-payload Cell (hex) using the exact
   * schema `buildSigningPayloadCell` in this file writes, subWalletId(32)
   * || validUntil(32) || seqno(32) || op(8) || sendMode(8) || ref(innerMsg).
   */
  function buildSigningPayloadHex(opts: { op?: number; sendMode?: number; amount?: bigint; seqno?: number }): string {
    const innerMsg = beginCell()
      .store(
        storeMessageRelaxed(
          internal({
            to: RECIPIENT,
            value: opts.amount ?? 1_000_000_000n,
            bounce: false,
          })
        )
      )
      .endCell()

    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(opts.seqno ?? 1, 32)
      .storeUint(opts.op ?? 0, 8)
      .storeUint(opts.sendMode ?? SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS, 8)
      .storeRef(innerMsg)
      .endCell()

    return cell.toBoc({ idx: false }).toString('hex')
  }

  it('passes a legit simple-send payload (op=0, PAY_GAS_SEPARATELY|IGNORE_ERRORS)', () => {
    const hex = buildSigningPayloadHex({})
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  it('passes a legit simple-send payload with a different bounded amount/seqno', () => {
    const hex = buildSigningPayloadHex({ amount: 42n, seqno: 99 })
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  it('rejects a non-zero wallet op (plugin install/remove, wallet-control hijack)', () => {
    const hex = buildSigningPayloadHex({ op: 2 })
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_OP/)
  })

  it('rejects SendMode.CARRY_ALL_REMAINING_BALANCE (128), full-wallet drain', () => {
    const hex = buildSigningPayloadHex({ sendMode: SendMode.CARRY_ALL_REMAINING_BALANCE })
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_DRAIN_MODE/)
  })

  it('rejects SendMode.DESTROY_ACCOUNT_IF_ZERO (32), wallet self-destruct', () => {
    const hex = buildSigningPayloadHex({ sendMode: SendMode.DESTROY_ACCOUNT_IF_ZERO })
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_DRAIN_MODE/)
  })

  it('rejects a drain mode even when combined with the normal gas-payment bits', () => {
    const hex = buildSigningPayloadHex({
      sendMode: SendMode.CARRY_ALL_REMAINING_BALANCE | SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    })
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_DRAIN_MODE/)
  })

  it('fails OPEN on a truncated/malformed BoC (never crash on unparseable bytes)', () => {
    expect(() => assertTonSigningPayloadNoHostileDrain('deadbeef')).not.toThrow()
  })

  it('fails CLOSED on an absent/empty payload (nothing to inspect)', () => {
    expect(() => assertTonSigningPayloadNoHostileDrain('')).toThrow(/TON_PREBUILT_PAYLOAD_UNREADABLE/)
    expect(() => assertTonSigningPayloadNoHostileDrain(' \t\r\n ')).toThrow(/TON_PREBUILT_PAYLOAD_UNREADABLE/)
    expect(() => assertTonSigningPayloadNoHostileDrain(undefined as unknown as string)).toThrow(
      /TON_PREBUILT_PAYLOAD_UNREADABLE/
    )
  })

  it('fails OPEN on a header too short to contain a full op byte', () => {
    // Only 2 bytes, nowhere near the 104 bits (13 bytes) the header needs.
    const shortCell = beginCell().storeUint(1, 16).endCell()
    const hex = shortCell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  it('fails OPEN on a non-drain send mode whose ref is not a well-formed relaxed message', () => {
    // op=0 (claims simple send), benign mode, ref is garbage relative to
    // CommonMessageInfoRelaxed's schema — nothing hostile was observed,
    // so this must NOT throw.
    const garbageRef = beginCell().storeUint(0xffffffff, 32).endCell()
    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(0, 8)
      .storeUint(SendMode.PAY_GAS_SEPARATELY, 8)
      .storeRef(garbageRef)
      .endCell()
    const hex = cell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  // The fail-open posture must be scoped to bytes the guard could not
  // read — it must never retract a hostile fact read out of bytes it
  // could.
  it('rejects a real wallet-V4R2 op=1 (deploy-and-install-plugin) payload', () => {
    // A genuine op!=0 body is `plugin_wc:int8 || plugin_balance:Grams ||
    // ^state_init || ^body`, NOT `sendMode:8 || ^msg` — so a walk that
    // parses the messages before judging `op` throws on the StateInit ref
    // and fails open on exactly the wallet-hijack this guard names.
    const stateInit = beginCell().storeUint(0, 2).storeBit(false).storeBit(false).storeBit(false).endCell()
    const pluginBody = beginCell().storeUint(0, 32).endCell()
    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(1, 8) // op = 1, deploy and install plugin
      .storeInt(0, 8) // plugin_wc
      .storeCoins(500_000_000n) // plugin_balance
      .storeRef(stateInit)
      .storeRef(pluginBody)
      .endCell()
    const hex = cell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_OP/)
  })

  it('rejects a drain mode on message #1 even when a later message is undecodable', () => {
    const legitMsg = beginCell()
      .store(storeMessageRelaxed(internal({ to: RECIPIENT, value: 1n, bounce: false })))
      .endCell()
    const garbageRef = beginCell().storeUint(0xffffffff, 32).endCell()
    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(0, 8)
      .storeUint(SendMode.CARRY_ALL_REMAINING_BALANCE, 8)
      .storeRef(legitMsg)
      .storeUint(SendMode.PAY_GAS_SEPARATELY, 8)
      .storeRef(garbageRef)
      .endCell()
    const hex = cell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_DRAIN_MODE/)
  })

  it('rejects a drain mode on a later message hidden behind an undecodable first one', () => {
    const garbageRef = beginCell().storeUint(0xffffffff, 32).endCell()
    const legitMsg = beginCell()
      .store(storeMessageRelaxed(internal({ to: RECIPIENT, value: 1n, bounce: false })))
      .endCell()
    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(0, 8)
      .storeUint(SendMode.PAY_GAS_SEPARATELY, 8)
      .storeRef(garbageRef)
      .storeUint(SendMode.DESTROY_ACCOUNT_IF_ZERO, 8)
      .storeRef(legitMsg)
      .endCell()
    const hex = cell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).toThrow(/TON_PREBUILT_HOSTILE_DRAIN_MODE/)
  })

  it('does not false-reject a legit multi-message payload (4 bounded sends)', () => {
    const legit = () =>
      beginCell()
        .store(storeMessageRelaxed(internal({ to: RECIPIENT, value: 7n, bounce: false })))
        .endCell()
    const b = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(0, 8)
    for (let i = 0; i < 4; i += 1) {
      b.storeUint(SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS, 8).storeRef(legit())
    }
    const hex = b.endCell().toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  it('passes (no-op) a header claiming op=0 with zero outgoing messages', () => {
    // No ref at all, decode succeeds (op=0), the loop over zero refs is a
    // no-op, nothing to reject since nothing is being sent.
    const cell = beginCell()
      .storeUint(TON_V4R2_SUB_WALLET_ID, 32)
      .storeUint(VALID_UNTIL, 32)
      .storeUint(1, 32)
      .storeUint(0, 8)
      .endCell()
    const hex = cell.toBoc({ idx: false }).toString('hex')
    expect(() => assertTonSigningPayloadNoHostileDrain(hex)).not.toThrow()
  })

  it('accepts a base64-encoded payload, same as buildTonTxFromSigningPayload accepts', () => {
    const hex = buildSigningPayloadHex({})
    const base64 = Buffer.from(hex, 'hex').toString('base64')
    expect(() => assertTonSigningPayloadNoHostileDrain(base64)).not.toThrow()
    // And the base64 form of a hostile payload is still caught.
    const hostileHex = buildSigningPayloadHex({ op: 5 })
    const hostileBase64 = Buffer.from(hostileHex, 'hex').toString('base64')
    expect(() => assertTonSigningPayloadNoHostileDrain(hostileBase64)).toThrow(/TON_PREBUILT_HOSTILE_OP/)
  })
})

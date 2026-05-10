/**
 * Phase D — non-EVM envelope parsing tests.
 *
 * Validates `parseNonEvmEnvelope` converts mcp-ts execute_send wire shapes
 * into `vault.send`-shaped args. Live envelopes captured from the real
 * agent path on 2026-05-10 (see task 100526-sdk-cli-non-evm-signing.md).
 *
 * Critical invariants locked here:
 * - `txArgs.amount` is base-unit integer string; parser converts via
 *   `formatUnits(BigInt(amount), chainDecimals)` before vault.send.
 * - For native sends, `symbol` is undefined (vault.send defaults to
 *   native chain coin).
 * - Memo passes through unchanged when present, undefined when empty.
 * - Missing required fields throw with `VaultError` typed errors.
 */
import { Chain, VaultError, VaultErrorCode } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { parseNonEvmEnvelope } from '../executor'

describe('parseNonEvmEnvelope', () => {
  describe('Bitcoin (utxo kind)', () => {
    // Real envelope captured via `vsig agent ask "send 0.00001 BTC ..."` on 2026-05-10.
    const btcEnvelope = {
      chain: 'Bitcoin',
      from_chain: 'Bitcoin',
      resolved: {
        labels: {
          resolved_amount: '0.00001 BTC',
          normalized_chain: 'Bitcoin',
          token: 'BTC (native on Bitcoin, 8 dec, source: native)',
          token_resolved: 'BTC',
        },
      },
      stepperConfig: { flow: 'send', steps: [] },
      txArgs: {
        chain: 'Bitcoin',
        tx_encoding: 'utxo-psbt',
        from: 'bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
        to: 'bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
        amount: '1000',
        fee_rate: 3,
        memo: '',
      },
    }

    it('converts sats integer amount to decimal BTC string', () => {
      const args = parseNonEvmEnvelope(btcEnvelope, Chain.Bitcoin)
      expect(args.chain).toBe(Chain.Bitcoin)
      expect(args.to).toBe('bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
      // 1000 sats = 0.00001 BTC (8 decimals)
      expect(args.amount).toBe('0.00001')
    })

    it('omits symbol for native BTC sends', () => {
      const args = parseNonEvmEnvelope(btcEnvelope, Chain.Bitcoin)
      expect(args.symbol).toBeUndefined()
    })

    it('omits memo when envelope memo is empty string', () => {
      const args = parseNonEvmEnvelope(btcEnvelope, Chain.Bitcoin)
      expect(args.memo).toBeUndefined()
    })

    it('round-trips amount: viem parseUnits(parsed, 8) === original sats bigint', async () => {
      const { parseUnits } = await import('viem')
      const args = parseNonEvmEnvelope(btcEnvelope, Chain.Bitcoin)
      // viem's parseUnits is what vault.send uses internally for the
      // inverse direction. Round-trip is exact (no floating-point).
      expect(parseUnits(args.amount, 8)).toBe(BigInt(btcEnvelope.txArgs.amount))
    })
  })

  describe('Solana (solana kind)', () => {
    // Real envelope captured from `vsig agent ask "send 0.001 SOL ..."`.
    const solEnvelope = {
      chain: 'Solana',
      from_chain: 'Solana',
      resolved: {
        labels: {
          resolved_amount: '0.001 SOL',
          token: 'SOL (native on Solana, 9 dec, source: native)',
          token_resolved: 'SOL',
        },
      },
      txArgs: {
        chain: 'Solana',
        tx_encoding: 'solana-tx',
        from: 'iwMx27vvAiaQteMhdpSBVDRztiSt1Cxwcfkm6SQBpxA',
        to: 'iwMx27vvAiaQteMhdpSBVDRztiSt1Cxwcfkm6SQBpxA',
        amount: '1000000',
      },
    }

    it('converts lamports to decimal SOL', () => {
      const args = parseNonEvmEnvelope(solEnvelope, Chain.Solana)
      // 1,000,000 lamports = 0.001 SOL (9 decimals)
      expect(args.amount).toBe('0.001')
      expect(args.to).toBe('iwMx27vvAiaQteMhdpSBVDRztiSt1Cxwcfkm6SQBpxA')
      expect(args.symbol).toBeUndefined()
    })
  })

  describe('THORChain (cosmos kind) — with memo', () => {
    // Real envelope captured from `vsig agent ask "send 0.01 RUNE ... with memo 'X'"`.
    const runeEnvelope = {
      chain: 'THORChain',
      from_chain: 'THORChain',
      resolved: {
        labels: {
          resolved_amount: '0.01 RUNE',
          token: 'RUNE (native on THORChain, 8 dec, source: native)',
          token_resolved: 'RUNE',
        },
      },
      txArgs: {
        chain: 'THORChain',
        tx_encoding: 'cosmos-msg',
        from: 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm',
        to: 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm',
        amount: '1000000',
        denom: 'rune',
        chain_id: 'thorchain-1',
        account_number: '0', // stale; SDK overrides at sign time
        sequence: '0', // stale; SDK overrides at sign time
        memo: 'test-memo-phase-d',
        msg_type: 'send',
      },
    }

    it('converts uatom-equiv to decimal RUNE', () => {
      const args = parseNonEvmEnvelope(runeEnvelope, Chain.THORChain)
      // 1,000,000 base units = 0.01 RUNE (8 decimals)
      expect(args.amount).toBe('0.01')
    })

    it('passes memo through unchanged', () => {
      const args = parseNonEvmEnvelope(runeEnvelope, Chain.THORChain)
      expect(args.memo).toBe('test-memo-phase-d')
    })

    it('ignores cosmos-specific fields (denom, chain_id, sequence) — SDK overrides at sign time', () => {
      const args = parseNonEvmEnvelope(runeEnvelope, Chain.THORChain)
      // Parsed shape only carries vault.send-relevant fields; cosmos extras
      // (denom, chain_id, account_number, sequence, msg_type) are
      // intentionally NOT surfaced. The SDK re-fetches account state
      // during prepareSendTx for cosmos chains, ignoring the envelope's
      // stale values.
      const definedKeys = Object.entries(args)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k)
        .sort()
      expect(definedKeys).toEqual(['amount', 'chain', 'memo', 'to'])
      // Defensive: confirm none of the cosmos-extras leaked.
      expect((args as any).denom).toBeUndefined()
      expect((args as any).chain_id).toBeUndefined()
      expect((args as any).sequence).toBeUndefined()
    })
  })

  describe('error paths', () => {
    it('throws when serverTxData is null/undefined', () => {
      expect(() => parseNonEvmEnvelope(null as any, Chain.Bitcoin)).toThrow(/missing txArgs/)
      expect(() => parseNonEvmEnvelope(undefined as any, Chain.Bitcoin)).toThrow(/missing txArgs/)
    })

    it('throws on missing to field', () => {
      expect(() => parseNonEvmEnvelope({ txArgs: { amount: '1000' } } as any, Chain.Bitcoin)).toThrow(
        /missing 'to' field/
      )
    })

    it('throws on missing amount field', () => {
      expect(() => parseNonEvmEnvelope({ txArgs: { to: 'bc1q...' } } as any, Chain.Bitcoin)).toThrow(
        /missing 'amount' field/
      )
    })

    it('throws on invalid (non-numeric) amount string', () => {
      expect(() =>
        parseNonEvmEnvelope({ txArgs: { to: 'bc1q...', amount: 'not-a-number' } } as any, Chain.Bitcoin)
      ).toThrow(/failed to convert amount/)
    })

    it('throws VaultError instances (not plain Error) for downstream normalizeAgentError', () => {
      try {
        parseNonEvmEnvelope({} as any, Chain.Bitcoin)
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        expect((err as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      }
    })
  })
})

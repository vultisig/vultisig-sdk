/**
 * SOL self-send — silent-broadcast verifier (first scripted on-chain
 * SOL run via sdk-cli).
 *
 * Drives a real 0.0001 SOL mainnet self-send through `vsig agent ask`,
 * then independently verifies via `getTransaction` (finalized) on
 * api.mainnet-beta.solana.com.
 *
 * Expected: PASS or FIND BUG. This is the first time the full SOL
 * sign+broadcast path is exercised end-to-end with on-chain
 * verification. Solana uses hardened ed25519 derivation, so this also
 * implicitly checks that the address sdk-cli signs with matches the
 * one agent-backend's envelope declares — related to the
 * chain_public_keys forwarding gap (sibling task
 * 180526-sdk-cli-chain-public-keys-parity.md). A wrong-address symptom
 * here is a cross-task signal, not necessarily a silent-broadcast bug.
 *
 * Gated on FUND_SAFETY_E2E. Cost ≈ $0.0001 SOL + fees/run. Self-send.
 *
 * The SOL vault address is NOT hardcoded — it must be supplied via
 * FUND_SAFETY_SOL_ADDR (derive it from the same vault and confirm it
 * holds SOL before running; see task QUESTION protocol). Without it the
 * test fails fast with a clear message rather than guessing an address.
 */
import { describe, expect, it } from 'vitest'

import {
  assertBroadcastMatches,
  captureBroadcast,
  shouldRunE2E,
  SilentBroadcastError,
  verifyOnChain,
  writeArtifact,
} from '../lib/harness'

const VAULT_SOL_ADDR = process.env.FUND_SAFETY_SOL_ADDR?.toLowerCase()
const SEND_SOL = '0.0001'
const SEND_LAMPORTS = (BigInt(1) * 10n ** 5n).toString() // 0.0001 * 1e9

describe.skipIf(!shouldRunE2E())('fund-safety: SOL self-send (silent-broadcast)', () => {
  it(
    'broadcasts 0.0001 SOL self-send and the tx is verifiable on an independent RPC',
    async () => {
      if (!VAULT_SOL_ADDR) {
        throw new Error(
          'FUND_SAFETY_SOL_ADDR not set. Derive the Solana address from the test ' +
            'vault, confirm it holds SOL, and pass it explicitly. The harness will ' +
            'not guess a Solana address (hardened derivation — wrong address risks ' +
            'a real loss).'
        )
      }
      const prompt = `send ${SEND_SOL} SOL to ${VAULT_SOL_ADDR}`
      const capture = await captureBroadcast('solana', prompt)

      const onChain = capture.hash
        ? await verifyOnChain('solana', capture.hash, { timeoutSec: 90 })
        : { exists: false, raw: { note: 'no signature returned by sdk-cli' } }

      writeArtifact('sol-self-send', {
        ts: new Date().toISOString(),
        prompt,
        capture: { ...capture, rawStdout: undefined, rawStderr: undefined },
        onChain,
        expected: { from: VAULT_SOL_ADDR, to: VAULT_SOL_ADDR, valueLamports: SEND_LAMPORTS },
      })

      try {
        assertBroadcastMatches(capture, onChain, {
          fromAddr: VAULT_SOL_ADDR,
          toAddr: VAULT_SOL_ADDR,
          value: SEND_LAMPORTS,
        })
      } catch (e) {
        if (e instanceof SilentBroadcastError) {
          throw new Error(
            `${e.message}\n\n` +
              `sdk-cli signature: ${capture.hash}\n` +
              `on-chain exists: ${onChain.exists}\n` +
              `on-chain from: ${onChain.fromAddr} (expected ${VAULT_SOL_ADDR})\n` +
              `agent response: ${capture.response.slice(0, 300)}\n` +
              `tool calls: ${JSON.stringify(capture.toolCalls.map(t => ({ a: t.action, ok: t.success })))}\n` +
              `NOTE: a from-address mismatch may indicate the chain_public_keys ` +
              `forwarding gap (sibling task), not a silent-broadcast bug.`
          )
        }
        throw e
      }

      expect(onChain.exists).toBe(true)
      expect(onChain.blockNumber).toBeTypeOf('number')
    },
    300_000
  )
})

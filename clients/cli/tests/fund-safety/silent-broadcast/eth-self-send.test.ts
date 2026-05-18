/**
 * ETH self-send — silent-broadcast verifier (canonical happy path).
 *
 * Drives a real 0.0001 ETH mainnet self-send through `vsig agent ask`,
 * then independently verifies the tx landed via `eth_getTransactionByHash`
 * on ethereum-rpc.publicnode.com (NOT sdk-cli's broadcast downstream).
 *
 * Expected: PASS. If this fails we have a regression in the canonical
 * EVM broadcast path — investigate before trusting any other chain
 * result.
 *
 * Gated on FUND_SAFETY_E2E. Cost ≈ $0.30 gas/run. Self-send only —
 * never a placeholder/burn recipient.
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

// Canonical test wallet (Vultisig Cluster #1). Self-send: from === to.
const VAULT_ETH_ADDR = (
  process.env.FUND_SAFETY_ETH_ADDR ?? '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35'
).toLowerCase()
const SEND_ETH = '0.0001'
const SEND_WEI = (BigInt(1) * 10n ** 14n).toString() // 0.0001 * 1e18

describe.skipIf(!shouldRunE2E())('fund-safety: ETH self-send (silent-broadcast)', () => {
  it(
    'broadcasts 0.0001 ETH self-send and the tx is verifiable on an independent RPC',
    async () => {
      const prompt = `send ${SEND_ETH} ETH to ${VAULT_ETH_ADDR}`
      const capture = await captureBroadcast('ethereum', prompt)

      const onChain = capture.hash
        ? await verifyOnChain('ethereum', capture.hash, { timeoutSec: 90 })
        : { exists: false, raw: { note: 'no hash returned by sdk-cli' } }

      writeArtifact('eth-self-send', {
        ts: new Date().toISOString(),
        prompt,
        capture: { ...capture, rawStdout: undefined, rawStderr: undefined },
        onChain,
        expected: { from: VAULT_ETH_ADDR, to: VAULT_ETH_ADDR, valueWei: SEND_WEI, chainId: 1 },
      })

      try {
        assertBroadcastMatches(capture, onChain, {
          fromAddr: VAULT_ETH_ADDR,
          toAddr: VAULT_ETH_ADDR,
          value: SEND_WEI,
          chainId: 1,
        })
      } catch (e) {
        if (e instanceof SilentBroadcastError) {
          // Surface the forensic context in the test failure so triage
          // doesn't need to dig through last-run/.
          throw new Error(
            `${e.message}\n\n` +
              `sdk-cli hash: ${capture.hash}\n` +
              `on-chain exists: ${onChain.exists}\n` +
              `agent response: ${capture.response.slice(0, 300)}\n` +
              `tool calls: ${JSON.stringify(capture.toolCalls.map(t => ({ a: t.action, ok: t.success })))}`
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

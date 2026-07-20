/**
 * PTY fixture for the interactive `send` decline (F1). Runs the REAL exit wiring
 * — `withExit(() => sendTransaction(...))` with `yes:false` — against a fake vault
 * so it reaches the interactive confirm prompt with no network. Driven under a
 * pseudo-terminal (see sendDeclinePty.test.ts) that feeds "n": the human declines,
 * `sendTransaction` throws `ConfirmationRequiredError`, and `withExit` exits 12.
 * The test reads the child's real exit code from node-pty's `onExit`.
 *
 * argv: [table|json]
 */
import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'

import { withExit } from '../../../adapters/cli-runner'
import { initOutputMode } from '../../../lib/output'
import { sendTransaction } from '../../transaction'

const [mode = 'table'] = process.argv.slice(2)

initOutputMode({ output: mode })

const payload = {
  coin: { isNativeToken: true, ticker: 'ETH', contractAddress: '', chain: 'Ethereum', address: '0xsender' },
  toAddress: '0xrecipient',
  toAmount: '1000000000000000000',
} as unknown as KeysignPayload

const vault = {
  type: 'fast',
  isEncrypted: false,
  isUnlocked: () => true,
  id: 'vault-decline-fixture',
  name: 'vault-decline-fixture',
  publicKeys: { ecdsa: '0xEcdsaOwnerPubKey', eddsa: '' },
  send: async (params: { dryRun?: boolean; chain: Chain }) =>
    params.dryRun
      ? { dryRun: true as const, fee: '0.001', total: '1', keysignPayload: payload }
      : { dryRun: false as const, txHash: '0xshouldnothappen', chain: params.chain },
  gas: async () => {
    throw new Error('gas unavailable in fixture')
  },
  balance: async () => ({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
  address: async () => '0xsender',
  on: () => vault,
  removeAllListeners: () => vault,
} as unknown as VaultBase

// yes:false → the interactive confirm prompt runs. The confirm default is false,
// so a fed "n" (or a bare EOF) both decline → ConfirmationRequiredError → exit 12.
await withExit(async () => {
  await sendTransaction(vault, { chain: Chain.Ethereum, to: '0xrecipient', amount: '1', yes: false })
})()

import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'

import { classifyError } from '../../../core/errors'
import { setSilentMode } from '../../../lib/output'
import { sendTransaction } from '../../transaction'

const [journalPath, amount = '1', forceArg = 'false'] = process.argv.slice(2)
if (!journalPath) throw new Error('journal path is required')

process.env.VULTISIG_BROADCAST_JOURNAL_PATH = journalPath
setSilentMode(true)

const payload = {
  coin: {
    isNativeToken: true,
    ticker: 'ETH',
    contractAddress: '',
    chain: 'Ethereum',
    address: '0xsender',
  },
  toAddress: '0xrecipient',
  toAmount: amount === '1' ? '1000000000000000000' : '2000000000000000000',
} as unknown as KeysignPayload

const vault = {
  type: 'fast',
  isEncrypted: false,
  isUnlocked: () => true,
  id: 'vault-process-fixture',
  name: 'vault-process-fixture',
  publicKeys: { ecdsa: '0xEcdsaOwnerPubKey', eddsa: '' },
  send: async (params: { dryRun?: boolean; chain: Chain }) =>
    params.dryRun
      ? { dryRun: true as const, fee: '0.001', total: amount, keysignPayload: payload }
      : { dryRun: false as const, txHash: `0xmock-${amount}`, chain: params.chain },
  gas: async () => {
    throw new Error('gas unavailable in fixture')
  },
  balance: async () => ({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
  address: async () => '0xsender',
  on: () => vault,
  removeAllListeners: () => vault,
} as unknown as VaultBase

try {
  await sendTransaction(vault, {
    chain: Chain.Ethereum,
    to: '0xrecipient',
    amount,
    yes: true,
    force: forceArg === 'true',
  })
} catch (error) {
  const classified = classifyError(error instanceof Error ? error : new Error(String(error)))
  process.stderr.write(`${classified.message}\n`)
  process.exitCode = classified.exitCode
}

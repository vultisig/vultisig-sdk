import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain, chainFeeCoin, cosmosFeeCoinDenom, getCosmosGasLimit } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => false,
  isJsonOutput: () => true,
  isSilent: () => true,
  outputJson: vi.fn(),
  printResult: vi.fn(),
}))

vi.mock('../../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(true),
  displayTransactionResult: vi.fn(),
}))

import { executeExecute } from '../execute'

type PrepareCall = {
  chain: Chain
  coin: { chain: Chain; address: string; decimals: number; ticker: string }
  fee: { amount: Array<{ denom: string; amount: string }>; gas: string }
  memo?: string
  msgs: unknown[]
}

function makeVault(chain: Chain) {
  const prepareSignAminoTx = vi.fn(async (payload: PrepareCall) => payload as unknown as KeysignPayload)
  const extractMessageHashes = vi.fn(async () => ['hash'])
  const sign = vi.fn(async () => ({ signatures: [] }))
  const broadcastTx = vi.fn(async () => 'tx-hash')

  const vault = {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: `vault-${chain}`,
    name: `vault-${chain}`,
    publicKeys: { ecdsa: '0xecdsa', eddsa: '' },
    address: vi.fn().mockResolvedValue(`${String(chain).toLowerCase()}1sender`),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    prepareSignAminoTx,
    extractMessageHashes,
    sign,
    broadcastTx,
  } as unknown as VaultBase

  return { vault, prepareSignAminoTx, extractMessageHashes, sign, broadcastTx }
}

describe('executeExecute Cosmos config', () => {
  it.each([Chain.THORChain, Chain.MayaChain])('uses canonical SDK fee metadata for %s', async chain => {
    const { vault, prepareSignAminoTx, sign, broadcastTx } = makeVault(chain)
    const ctx = { ensureActiveVault: async () => vault } as never

    await executeExecute(ctx, {
      chain,
      contract: `${String(chain).toLowerCase()}1contract`,
      msg: '{"swap":{}}',
      yes: true,
      memo: 'memo',
    })

    expect(prepareSignAminoTx).toHaveBeenCalledTimes(1)
    const payload = prepareSignAminoTx.mock.calls[0][0] as PrepareCall
    const denom = cosmosFeeCoinDenom[chain]
    const feeCoin = chainFeeCoin[chain]

    expect(payload.coin).toEqual({
      chain,
      address: `${String(chain).toLowerCase()}1sender`,
      decimals: feeCoin.decimals,
      ticker: feeCoin.ticker,
    })
    expect(payload.fee).toEqual({
      amount: [{ denom, amount: '0' }],
      gas: getCosmosGasLimit({ chain, id: denom }).toString(),
    })

    expect(sign).toHaveBeenCalledTimes(1)
    expect(broadcastTx).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported chains with a stable supported-chains list', async () => {
    const { vault, prepareSignAminoTx } = makeVault(Chain.THORChain)
    const ctx = { ensureActiveVault: async () => vault } as never

    await expect(
      executeExecute(ctx, {
        chain: Chain.Cosmos,
        contract: 'cosmos1contract',
        msg: '{"swap":{}}',
        yes: true,
      })
    ).rejects.toThrow('Chain Cosmos does not support CosmWasm execute. Supported chains: THORChain, MayaChain')

    expect(prepareSignAminoTx).not.toHaveBeenCalled()
  })
})

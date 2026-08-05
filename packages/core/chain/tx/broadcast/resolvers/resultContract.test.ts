import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcastCosmos: vi.fn(),
  executeSui: vi.fn(),
  queryUrl: vi.fn(),
  sendEvm: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: () => ({ broadcastTx: mocks.broadcastCosmos }),
}))
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ sendRawTransaction: mocks.sendEvm }),
}))
vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ executeTransactionBlock: mocks.executeSui }),
}))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))
vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { Chain, CosmosChain, EvmChain, OtherChain } from '../../../Chain'
import type { BroadcastTxResolver } from '../resolver'
import { BroadcastErrorCode } from '../resolver'
import { broadcastBittensorTx } from './bittensor'
import { broadcastCosmosTx } from './cosmos'
import { broadcastEvmTx } from './evm'
import { broadcastQbtcTx } from './qbtc'
import { broadcastSuiTx } from './sui'
import { broadcastTonTx } from './ton'
import { broadcastTronTx } from './tron'

const originalFetch = globalThis.fetch
const encoded = new Uint8Array([0x01, 0x02, 0x03])

type ContractCase = {
  resolver: BroadcastTxResolver<any>
  input: { chain: Chain; tx: any }
  txHash: string
  accept: () => void
  reject: () => void
  failTransient: () => void
}

const successfulFetch = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  })

const cases: Record<string, ContractCase> = {
  bittensor: {
    resolver: broadcastBittensorTx,
    input: { chain: OtherChain.Bittensor, tx: { encoded } },
    txHash: '0xbittensor-hash',
    accept: () => mocks.queryUrl.mockResolvedValue({ result: '0xbittensor-hash' }),
    reject: () => mocks.queryUrl.mockResolvedValue({ error: { code: 1010, message: 'Invalid Transaction' } }),
    failTransient: () => mocks.queryUrl.mockRejectedValue(new Error('ECONNRESET')),
  },
  cosmos: {
    resolver: broadcastCosmosTx,
    input: {
      chain: CosmosChain.Cosmos,
      tx: { serialized: JSON.stringify({ tx_bytes: Buffer.from(encoded).toString('base64') }) },
    },
    txHash: 'cosmos-hash',
    accept: () => mocks.broadcastCosmos.mockResolvedValue({ transactionHash: 'cosmos-hash' }),
    reject: () => mocks.broadcastCosmos.mockRejectedValue(new Error('insufficient fee')),
    failTransient: () => mocks.broadcastCosmos.mockRejectedValue(new Error('ECONNRESET')),
  },
  evm: {
    resolver: broadcastEvmTx,
    input: { chain: EvmChain.Ethereum, tx: { encoded } },
    txHash: '0xevm-hash',
    accept: () => mocks.sendEvm.mockResolvedValue('0xevm-hash'),
    reject: () => mocks.sendEvm.mockRejectedValue(new Error('nonce too low')),
    failTransient: () => mocks.sendEvm.mockRejectedValue(new Error('ECONNRESET')),
  },
  qbtc: {
    resolver: broadcastQbtcTx,
    input: {
      chain: OtherChain.QBTC,
      tx: { serialized: JSON.stringify({ tx_bytes: Buffer.from(encoded).toString('base64') }) },
    },
    txHash: 'qbtc-hash',
    accept: () => {
      globalThis.fetch = successfulFetch({ tx_response: { code: 0, txhash: 'qbtc-hash' } })
    },
    reject: () => {
      globalThis.fetch = successfulFetch({ tx_response: { code: 5, raw_log: 'signature rejected' } })
    },
    failTransient: () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    },
  },
  sui: {
    resolver: broadcastSuiTx,
    input: { chain: OtherChain.Sui, tx: { unsignedTx: 'bytes', signature: 'signature' } },
    txHash: 'sui-hash',
    accept: () => mocks.executeSui.mockResolvedValue({ digest: 'sui-hash', effects: { status: 'success' } }),
    reject: () => mocks.executeSui.mockRejectedValue(new Error('invalid signature')),
    failTransient: () => mocks.executeSui.mockRejectedValue(new Error('ECONNRESET')),
  },
  ton: {
    resolver: broadcastTonTx,
    input: { chain: OtherChain.Ton, tx: { encoded: 'boc' } },
    txHash: 'ton-hash',
    accept: () => mocks.queryUrl.mockResolvedValue({ result: { hash: 'ton-hash' } }),
    reject: () => mocks.queryUrl.mockRejectedValue(new Error('invalid boc')),
    failTransient: () => mocks.queryUrl.mockRejectedValue(new Error('ECONNRESET')),
  },
  tron: {
    resolver: broadcastTronTx,
    input: { chain: OtherChain.Tron, tx: { json: { raw_data_hex: '00' } } },
    txHash: 'tron-hash',
    accept: () => mocks.queryUrl.mockResolvedValue({ txid: 'tron-hash', result: true }),
    reject: () =>
      mocks.queryUrl.mockResolvedValue({
        txid: 'tron-hash',
        result: false,
        code: 'SIGERROR',
        message: Buffer.from('invalid signature').toString('hex'),
      }),
    failTransient: () => mocks.queryUrl.mockRejectedValue(new Error('ECONNRESET')),
  },
}

describe.each(Object.entries(cases))('%s broadcast resolver result contract', (_name, contract) => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    mocks.verifyBroadcastByHash.mockImplementation(({ error }) => Promise.reject(error))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('normalizes an accepted provider response and canonical transaction id', async () => {
    contract.accept()

    await expect(contract.resolver(contract.input as any)).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: contract.txHash,
    })
  })

  it('normalizes a definitive provider rejection with its original cause', async () => {
    contract.reject()

    await expect(contract.resolver(contract.input as any)).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: expect.any(Error),
    })
  })

  it('normalizes a transient transport failure as retryable', async () => {
    contract.failTransient()

    await expect(contract.resolver(contract.input as any)).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
      cause: expect.objectContaining({ message: 'ECONNRESET' }),
    })
  })
})

describe('broadcast resolver unknown-cause preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyBroadcastByHash.mockRejectedValue(undefined)
  })

  it('does not mistake a falsy EVM rejection reason for an accepted broadcast', async () => {
    mocks.sendEvm.mockRejectedValue(undefined)

    await expect(broadcastEvmTx({ chain: EvmChain.Ethereum, tx: { encoded } as any })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: undefined,
    })
  })
})

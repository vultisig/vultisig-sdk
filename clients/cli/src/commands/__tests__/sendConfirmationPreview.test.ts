import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => false,
  isJsonOutput: () => false,
  outputJson: vi.fn(),
}))
vi.mock('../../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(false),
  displayTransactionPreview: vi.fn(),
  displayTransactionResult: vi.fn(),
}))

import { ConfirmationRequiredError } from '../../core/errors'
import { displayTransactionPreview } from '../../ui'
import { sendTransaction } from '../transaction'

const CLASSIC_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'
const X_ADDRESS = 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV'
const FROM_ADDRESS = 'rFromAddress'
const GAS = { estimatedFee: '0.000015' }

type PreviewCase = {
  name: string
  params: {
    chain: Chain
    to: string
    amount: string
    memo?: string
    destinationTag?: number
  }
  payloadMemo?: string
  payloadDestinationTag?: number
  contractAddress?: string
  expectedTo: string
  expectedMemo?: string
  expectedDestinationTag?: number
}

const cases: PreviewCase[] = [
  {
    name: 'numeric legacy memo',
    params: { chain: Chain.Ripple, to: CLASSIC_ADDRESS, amount: '1.0', memo: '12345' },
    payloadMemo: '12345',
    payloadDestinationTag: 12345,
    expectedTo: CLASSIC_ADDRESS,
    expectedDestinationTag: 12345,
  },
  {
    name: 'explicit destination tag only',
    params: { chain: Chain.Ripple, to: CLASSIC_ADDRESS, amount: '1.0', destinationTag: 12345 },
    payloadMemo: '12345',
    payloadDestinationTag: 12345,
    expectedTo: CLASSIC_ADDRESS,
    expectedDestinationTag: 12345,
  },
  {
    name: 'X-address embedded tag',
    params: { chain: Chain.Ripple, to: X_ADDRESS, amount: '1.0' },
    payloadMemo: '495',
    payloadDestinationTag: 495,
    expectedTo: CLASSIC_ADDRESS,
    expectedDestinationTag: 495,
  },
  {
    name: 'distinct memo alongside a tag',
    params: {
      chain: Chain.Ripple,
      to: CLASSIC_ADDRESS,
      amount: '1.0',
      memo: '67890',
      destinationTag: 12345,
    },
    payloadMemo: '67890',
    payloadDestinationTag: 12345,
    expectedTo: CLASSIC_ADDRESS,
    expectedMemo: '67890',
    expectedDestinationTag: 12345,
  },
  {
    name: 'non-Ripple payload memo',
    params: { chain: Chain.Ethereum, to: '0xrecipient', amount: '1.0', memo: 'memo-from-input' },
    payloadMemo: 'memo-from-signable-payload',
    expectedTo: '0xrecipient',
    expectedMemo: 'memo-from-signable-payload',
  },
  {
    name: 'token send discloses the resolved contract',
    params: { chain: Chain.Ethereum, to: '0xrecipient', amount: '1.0' },
    contractAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    expectedTo: '0xrecipient',
  },
]

function makeVault(testCase: PreviewCase): { vault: VaultBase; keysignPayload: KeysignPayload } {
  const keysignPayload = {
    memo: testCase.payloadMemo,
    blockchainSpecific:
      testCase.params.chain === Chain.Ripple
        ? {
            case: 'rippleSpecific',
            value: { destinationTag: testCase.payloadDestinationTag },
          }
        : { case: undefined, value: undefined },
  } as unknown as KeysignPayload

  const vault = {
    send: vi.fn().mockResolvedValue({
      dryRun: true,
      fee: '0.000015',
      feeSymbol: testCase.params.chain === Chain.Ripple ? 'XRP' : 'ETH',
      total: '1.000015',
      ...(testCase.contractAddress ? { contractAddress: testCase.contractAddress } : {}),
      keysignPayload,
    }),
    gas: vi.fn().mockResolvedValue(GAS),
    balance: vi.fn().mockResolvedValue({
      symbol: testCase.params.chain === Chain.Ripple ? 'XRP' : 'ETH',
      decimals: testCase.params.chain === Chain.Ripple ? 6 : 18,
      formattedAmount: '10',
    }),
    address: vi.fn().mockResolvedValue(FROM_ADDRESS),
  } as unknown as VaultBase

  return { vault, keysignPayload }
}

async function expectSignablePayloadPreview(testCase: PreviewCase): Promise<void> {
  const { vault, keysignPayload } = makeVault(testCase)

  const error = await sendTransaction(vault, testCase.params).catch(caught => caught)

  expect(error).toBeInstanceOf(ConfirmationRequiredError)
  expect(keysignPayload.memo, `${testCase.name}: payload memo`).toBe(testCase.payloadMemo)
  if (testCase.params.chain === Chain.Ripple) {
    expect(keysignPayload.blockchainSpecific, `${testCase.name}: payload destination tag`).toMatchObject({
      case: 'rippleSpecific',
      value: { destinationTag: testCase.payloadDestinationTag },
    })
  }
  expect(displayTransactionPreview, `${testCase.name}: confirmation preview`).toHaveBeenLastCalledWith(
    FROM_ADDRESS,
    testCase.expectedTo,
    '1.000015',
    testCase.params.chain === Chain.Ripple ? 'XRP' : 'ETH',
    testCase.params.chain,
    testCase.expectedMemo,
    testCase.expectedDestinationTag,
    GAS,
    testCase.contractAddress
  )
}

describe('send confirmation preview', () => {
  it('reports all four Ripple memo and destination-tag forms from the signable payload', async () => {
    for (const testCase of cases.filter(({ params }) => params.chain === Chain.Ripple)) {
      await expectSignablePayloadPreview(testCase)
    }
  })

  it('reports a non-Ripple memo from the signable payload', async () => {
    const testCase = cases.find(({ params }) => params.chain === Chain.Ethereum)
    expect(testCase).toBeDefined()
    await expectSignablePayloadPreview(testCase!)
  })

  it('passes the resolved token contract through to the confirmation preview', async () => {
    const testCase = cases.find(({ contractAddress }) => contractAddress !== undefined)
    expect(testCase).toBeDefined()
    await expectSignablePayloadPreview(testCase!)
  })
})

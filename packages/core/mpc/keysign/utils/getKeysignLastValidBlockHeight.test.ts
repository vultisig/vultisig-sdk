import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { EthereumSpecificSchema, SolanaSpecificSchema } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getKeysignLastValidBlockHeight } from './getKeysignLastValidBlockHeight'

const solanaPayload = (lastValidBlockHeight?: bigint): KeysignPayload =>
  create(KeysignPayloadSchema, {
    blockchainSpecific: {
      case: 'solanaSpecific',
      value: create(SolanaSpecificSchema, { recentBlockHash: 'hash', priorityFee: '0', lastValidBlockHeight }),
    },
  })

describe('getKeysignLastValidBlockHeight', () => {
  it('returns the recorded Solana deadline as a number', () => {
    expect(getKeysignLastValidBlockHeight(solanaPayload(312_456_789n))).toBe(312_456_789)
  })

  it('is undefined for a Solana payload built before the field existed', () => {
    expect(getKeysignLastValidBlockHeight(solanaPayload())).toBeUndefined()
  })

  it('is undefined for other chains', () => {
    const payload = create(KeysignPayloadSchema, {
      blockchainSpecific: {
        case: 'ethereumSpecific',
        value: create(EthereumSpecificSchema, { maxFeePerGasWei: '1', priorityFee: '1', nonce: 1n, gasLimit: '21000' }),
      },
    })

    expect(getKeysignLastValidBlockHeight(payload)).toBeUndefined()
  })

  it('refuses a value that does not fit a safe integer', () => {
    expect(getKeysignLastValidBlockHeight(solanaPayload(BigInt(Number.MAX_SAFE_INTEGER) + 1n))).toBeUndefined()
  })

  it('tolerates a partial payload with no chain-specific section', () => {
    expect(getKeysignLastValidBlockHeight({} as KeysignPayload)).toBeUndefined()
  })
})

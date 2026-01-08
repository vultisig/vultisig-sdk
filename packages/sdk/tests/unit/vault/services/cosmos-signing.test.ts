import { describe, expect, it } from 'vitest'

import type {
  CosmosCoinAmount,
  CosmosFeeInput,
  CosmosMsgInput,
  CosmosSigningOptions,
  SignAminoInput,
  SignDirectInput,
} from '../../../../src/types/cosmos'

/**
 * Unit tests for Cosmos signing types
 *
 * These tests verify the type definitions are correct and can be used properly.
 * Integration tests with actual signing require WalletCore initialization.
 */
describe('Cosmos Signing Types', () => {
  describe('CosmosCoinAmount', () => {
    it('should accept valid coin amount', () => {
      const coin: CosmosCoinAmount = {
        denom: 'uatom',
        amount: '1000000',
      }

      expect(coin.denom).toBe('uatom')
      expect(coin.amount).toBe('1000000')
    })

    it('should work with different denominations', () => {
      const atoms: CosmosCoinAmount = { denom: 'uatom', amount: '1000000' }
      const osmo: CosmosCoinAmount = { denom: 'uosmo', amount: '5000000' }
      const rune: CosmosCoinAmount = { denom: 'rune', amount: '100000000' }

      expect(atoms.denom).toBe('uatom')
      expect(osmo.denom).toBe('uosmo')
      expect(rune.denom).toBe('rune')
    })
  })

  describe('CosmosFeeInput', () => {
    it('should accept basic fee structure', () => {
      const fee: CosmosFeeInput = {
        amount: [{ denom: 'uatom', amount: '5000' }],
        gas: '200000',
      }

      expect(fee.amount).toHaveLength(1)
      expect(fee.amount[0].denom).toBe('uatom')
      expect(fee.gas).toBe('200000')
    })

    it('should accept fee with optional fields', () => {
      const fee: CosmosFeeInput = {
        amount: [{ denom: 'uatom', amount: '5000' }],
        gas: '200000',
        payer: 'cosmos1...',
        granter: 'cosmos2...',
      }

      expect(fee.payer).toBe('cosmos1...')
      expect(fee.granter).toBe('cosmos2...')
    })

    it('should accept multiple fee amounts', () => {
      const fee: CosmosFeeInput = {
        amount: [
          { denom: 'uatom', amount: '5000' },
          { denom: 'uosmo', amount: '10000' },
        ],
        gas: '300000',
      }

      expect(fee.amount).toHaveLength(2)
    })
  })

  describe('CosmosMsgInput', () => {
    it('should accept MsgSend format', () => {
      const msg: CosmosMsgInput = {
        type: 'cosmos-sdk/MsgSend',
        value: JSON.stringify({
          from_address: 'cosmos1...',
          to_address: 'cosmos2...',
          amount: [{ denom: 'uatom', amount: '1000000' }],
        }),
      }

      expect(msg.type).toBe('cosmos-sdk/MsgSend')
      expect(typeof msg.value).toBe('string')
    })

    it('should accept MsgVote format', () => {
      const msg: CosmosMsgInput = {
        type: 'cosmos-sdk/MsgVote',
        value: JSON.stringify({
          proposal_id: '123',
          voter: 'cosmos1...',
          option: 'VOTE_OPTION_YES',
        }),
      }

      expect(msg.type).toBe('cosmos-sdk/MsgVote')
    })

    it('should accept MsgDelegate format', () => {
      const msg: CosmosMsgInput = {
        type: 'cosmos-sdk/MsgDelegate',
        value: JSON.stringify({
          delegator_address: 'cosmos1...',
          validator_address: 'cosmosvaloper1...',
          amount: { denom: 'uatom', amount: '1000000' },
        }),
      }

      expect(msg.type).toBe('cosmos-sdk/MsgDelegate')
    })
  })

  describe('SignAminoInput', () => {
    it('should accept valid SignAmino input', () => {
      const input: SignAminoInput = {
        chain: 'Cosmos',
        coin: {
          chain: 'Cosmos',
          address: 'cosmos1...',
          decimals: 6,
          ticker: 'ATOM',
        },
        msgs: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: JSON.stringify({
              from_address: 'cosmos1...',
              to_address: 'cosmos2...',
              amount: [{ denom: 'uatom', amount: '1000000' }],
            }),
          },
        ],
        fee: {
          amount: [{ denom: 'uatom', amount: '5000' }],
          gas: '200000',
        },
      }

      expect(input.chain).toBe('Cosmos')
      expect(input.coin.ticker).toBe('ATOM')
      expect(input.msgs).toHaveLength(1)
      expect(input.fee.gas).toBe('200000')
    })

    it('should accept SignAmino with memo', () => {
      const input: SignAminoInput = {
        chain: 'Cosmos',
        coin: {
          chain: 'Cosmos',
          address: 'cosmos1...',
          decimals: 6,
          ticker: 'ATOM',
        },
        msgs: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: '{}',
          },
        ],
        fee: {
          amount: [{ denom: 'uatom', amount: '5000' }],
          gas: '200000',
        },
        memo: 'Test memo',
      }

      expect(input.memo).toBe('Test memo')
    })

    it('should accept SignAmino with multiple messages', () => {
      const input: SignAminoInput = {
        chain: 'Osmosis',
        coin: {
          chain: 'Osmosis',
          address: 'osmo1...',
          decimals: 6,
          ticker: 'OSMO',
        },
        msgs: [
          { type: 'cosmos-sdk/MsgSend', value: '{"amount":"100"}' },
          { type: 'cosmos-sdk/MsgSend', value: '{"amount":"200"}' },
          { type: 'cosmos-sdk/MsgSend', value: '{"amount":"300"}' },
        ],
        fee: {
          amount: [{ denom: 'uosmo', amount: '10000' }],
          gas: '300000',
        },
      }

      expect(input.msgs).toHaveLength(3)
    })

    it('should work with THORChain', () => {
      const input: SignAminoInput = {
        chain: 'THORChain',
        coin: {
          chain: 'THORChain',
          address: 'thor1...',
          decimals: 8,
          ticker: 'RUNE',
        },
        msgs: [
          {
            type: 'types/MsgDeposit',
            value: '{}',
          },
        ],
        fee: {
          amount: [{ denom: 'rune', amount: '2000000' }],
          gas: '400000',
        },
      }

      expect(input.chain).toBe('THORChain')
      expect(input.coin.decimals).toBe(8)
    })
  })

  describe('SignDirectInput', () => {
    it('should accept valid SignDirect input', () => {
      const input: SignDirectInput = {
        chain: 'Cosmos',
        coin: {
          chain: 'Cosmos',
          address: 'cosmos1...',
          decimals: 6,
          ticker: 'ATOM',
        },
        bodyBytes: 'base64EncodedBodyBytes...',
        authInfoBytes: 'base64EncodedAuthInfoBytes...',
        chainId: 'cosmoshub-4',
        accountNumber: '12345',
      }

      expect(input.chain).toBe('Cosmos')
      expect(input.bodyBytes).toBe('base64EncodedBodyBytes...')
      expect(input.authInfoBytes).toBe('base64EncodedAuthInfoBytes...')
      expect(input.chainId).toBe('cosmoshub-4')
      expect(input.accountNumber).toBe('12345')
    })

    it('should accept SignDirect with memo', () => {
      const input: SignDirectInput = {
        chain: 'Cosmos',
        coin: {
          chain: 'Cosmos',
          address: 'cosmos1...',
          decimals: 6,
          ticker: 'ATOM',
        },
        bodyBytes: 'base64...',
        authInfoBytes: 'base64...',
        chainId: 'cosmoshub-4',
        accountNumber: '12345',
        memo: 'Test memo',
      }

      expect(input.memo).toBe('Test memo')
    })

    it('should work with different chain IDs', () => {
      const cosmosInput: SignDirectInput = {
        chain: 'Cosmos',
        coin: { chain: 'Cosmos', address: 'cosmos1...', decimals: 6, ticker: 'ATOM' },
        bodyBytes: '',
        authInfoBytes: '',
        chainId: 'cosmoshub-4',
        accountNumber: '100',
      }

      const thorchainInput: SignDirectInput = {
        chain: 'THORChain',
        coin: { chain: 'THORChain', address: 'thor1...', decimals: 8, ticker: 'RUNE' },
        bodyBytes: '',
        authInfoBytes: '',
        chainId: 'thorchain-1',
        accountNumber: '200',
      }

      expect(cosmosInput.chainId).toBe('cosmoshub-4')
      expect(thorchainInput.chainId).toBe('thorchain-1')
    })
  })

  describe('CosmosSigningOptions', () => {
    it('should accept empty options', () => {
      const options: CosmosSigningOptions = {}

      expect(options.skipChainSpecificFetch).toBeUndefined()
    })

    it('should accept skipChainSpecificFetch option', () => {
      const options: CosmosSigningOptions = {
        skipChainSpecificFetch: true,
      }

      expect(options.skipChainSpecificFetch).toBe(true)
    })
  })
})

describe('Test Fixtures', () => {
  it('should load SignAmino fixture', async () => {
    const fixture = await import('../../../fixtures/cosmos-sdk-sign-amino.json')
    const testCases = fixture.default

    expect(Array.isArray(testCases)).toBe(true)
    expect(testCases.length).toBeGreaterThan(0)

    const firstCase = testCases[0]
    expect(firstCase).toHaveProperty('name')
    expect(firstCase).toHaveProperty('keysign_payload')
    expect(firstCase).toHaveProperty('expected_image_hash')

    // Verify SignAmino structure
    expect(firstCase.keysign_payload.sign_data).toHaveProperty('sign_amino')
    expect(firstCase.keysign_payload.sign_data.sign_amino).toHaveProperty('fee')
    expect(firstCase.keysign_payload.sign_data.sign_amino).toHaveProperty('msgs')
  })

  it('should load SignDirect fixture', async () => {
    const fixture = await import('../../../fixtures/cosmos-sdk-sign-direct.json')
    const testCases = fixture.default

    expect(Array.isArray(testCases)).toBe(true)
    expect(testCases.length).toBeGreaterThan(0)

    const firstCase = testCases[0]
    expect(firstCase).toHaveProperty('name')
    expect(firstCase).toHaveProperty('keysign_payload')
    expect(firstCase).toHaveProperty('expected_image_hash')

    // Verify SignDirect structure
    expect(firstCase.keysign_payload.sign_data).toHaveProperty('sign_direct')
    expect(firstCase.keysign_payload.sign_data.sign_direct).toHaveProperty('body_bytes')
    expect(firstCase.keysign_payload.sign_data.sign_direct).toHaveProperty('auth_info_bytes')
    expect(firstCase.keysign_payload.sign_data.sign_direct).toHaveProperty('chain_id')
    expect(firstCase.keysign_payload.sign_data.sign_direct).toHaveProperty('account_number')
  })

  it('should have valid expected image hashes', async () => {
    const aminoFixture = await import('../../../fixtures/cosmos-sdk-sign-amino.json')
    const directFixture = await import('../../../fixtures/cosmos-sdk-sign-direct.json')

    // Verify amino hashes are valid hex strings
    for (const testCase of aminoFixture.default) {
      for (const hash of testCase.expected_image_hash) {
        expect(hash).toMatch(/^[a-f0-9]{64}$/)
      }
    }

    // Verify direct hashes are valid hex strings
    for (const testCase of directFixture.default) {
      for (const hash of testCase.expected_image_hash) {
        expect(hash).toMatch(/^[a-f0-9]{64}$/)
      }
    }
  })
})

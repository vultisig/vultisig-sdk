/**
 * Unit Tests for formatGasInfo Adapter
 *
 * Tests the formatGasInfo function which converts core KeysignChainSpecific
 * data to SDK GasInfo format. Covers all 14 different chain-specific types.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatGasInfo } from '../../../src/adapters/formatGasInfo'

describe('formatGasInfo', () => {
  // Mock Date.now() to return a fixed timestamp for testing
  const mockTimestamp = 1700000000000
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)
  })

  describe('EVM Chains (ethereumSpecific)', () => {
    it('should format Ethereum EIP-1559 gas info with Wei and Gwei', () => {
      const chainSpecific = {
        case: 'ethereumSpecific' as const,
        value: {
          maxFeePerGasWei: '50000000000', // 50 Gwei
          priorityFee: '2000000000', // 2 Gwei
          nonce: BigInt(10),
          gasLimit: '21000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ethereum')

      expect(result).toEqual({
        chainId: 'Ethereum',
        gasPrice: '50000000000', // in Wei
        gasPriceGwei: '50', // in Gwei (50000000000 / 1e9)
        maxFeePerGas: '50000000000',
        priorityFee: '2000000000',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle very high gas prices (100+ Gwei)', () => {
      const chainSpecific = {
        case: 'ethereumSpecific' as const,
        value: {
          maxFeePerGasWei: '150000000000', // 150 Gwei
          priorityFee: '5000000000', // 5 Gwei
          nonce: BigInt(0),
          gasLimit: '21000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ethereum')

      expect(result.gasPriceGwei).toBe('150')
      expect(result.maxFeePerGas).toBe('150000000000')
      expect(result.priorityFee).toBe('5000000000')
    })

    it('should handle low gas prices (< 1 Gwei)', () => {
      const chainSpecific = {
        case: 'ethereumSpecific' as const,
        value: {
          maxFeePerGasWei: '500000000', // 0.5 Gwei
          priorityFee: '100000000', // 0.1 Gwei
          nonce: BigInt(0),
          gasLimit: '21000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ethereum')

      expect(result.gasPriceGwei).toBe('0') // Integer division
      expect(result.gasPrice).toBe('500000000')
    })

    it('should work for all EVM chains (Polygon, BSC, Arbitrum, etc.)', () => {
      const evmChains = ['Polygon', 'BSC', 'Arbitrum', 'Optimism', 'Base']

      for (const chain of evmChains) {
        const chainSpecific = {
          case: 'ethereumSpecific' as const,
          value: {
            maxFeePerGasWei: '30000000000',
            priorityFee: '1000000000',
            nonce: BigInt(0),
            gasLimit: '21000',
          },
        }

        const result = formatGasInfo(chainSpecific, chain)

        expect(result.chainId).toBe(chain)
        expect(result.gasPriceGwei).toBe('30')
      }
    })
  })

  describe('UTXO Chains (utxoSpecific)', () => {
    it('should format Bitcoin UTXO gas info with byte fee', () => {
      const chainSpecific = {
        case: 'utxoSpecific' as const,
        value: {
          byteFee: '10', // 10 sats/byte
          sendMaxAmount: false,
        },
      }

      const result = formatGasInfo(chainSpecific, 'Bitcoin')

      expect(result).toEqual({
        chainId: 'Bitcoin',
        gasPrice: '10',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle high byte fees (congested network)', () => {
      const chainSpecific = {
        case: 'utxoSpecific' as const,
        value: {
          byteFee: '150', // 150 sats/byte
          sendMaxAmount: false,
        },
      }

      const result = formatGasInfo(chainSpecific, 'Bitcoin')

      expect(result.gasPrice).toBe('150')
    })

    it('should work for all UTXO chains (Litecoin, Dogecoin, BCH, Dash)', () => {
      const utxoChains = [
        'Bitcoin',
        'Litecoin',
        'Dogecoin',
        'BitcoinCash',
        'Dash',
      ]

      for (const chain of utxoChains) {
        const chainSpecific = {
          case: 'utxoSpecific' as const,
          value: {
            byteFee: '5',
            sendMaxAmount: false,
          },
        }

        const result = formatGasInfo(chainSpecific, chain)

        expect(result.chainId).toBe(chain)
        expect(result.gasPrice).toBe('5')
      }
    })
  })

  describe('Cosmos Chains (cosmosSpecific)', () => {
    it('should format Cosmos gas info with gas field', () => {
      const chainSpecific = {
        case: 'cosmosSpecific' as const,
        value: {
          gas: BigInt(200000),
          accountNumber: BigInt(123),
          sequence: BigInt(45),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Cosmos')

      expect(result).toEqual({
        chainId: 'Cosmos',
        gasPrice: '200000',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle zero gas (free transactions)', () => {
      const chainSpecific = {
        case: 'cosmosSpecific' as const,
        value: {
          gas: BigInt(0),
          accountNumber: BigInt(0),
          sequence: BigInt(0),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Cosmos')

      expect(result.gasPrice).toBe('0')
    })

    it('should work for all Cosmos SDK chains (Osmosis, Kujira, dYdX)', () => {
      const cosmosChains = ['Cosmos', 'Osmosis', 'Kujira', 'dYdX', 'Noble']

      for (const chain of cosmosChains) {
        const chainSpecific = {
          case: 'cosmosSpecific' as const,
          value: {
            gas: BigInt(150000),
            accountNumber: BigInt(0),
            sequence: BigInt(0),
          },
        }

        const result = formatGasInfo(chainSpecific, chain)

        expect(result.chainId).toBe(chain)
        expect(result.gasPrice).toBe('150000')
      }
    })
  })

  describe('THORChain (thorchainSpecific)', () => {
    it('should format THORChain gas info with zero gas', () => {
      const chainSpecific = {
        case: 'thorchainSpecific' as const,
        value: {
          accountNumber: BigInt(123),
          sequence: BigInt(45),
          fee: BigInt(0),
          isDeposit: false,
        },
      }

      const result = formatGasInfo(chainSpecific, 'THORChain')

      expect(result).toEqual({
        chainId: 'THORChain',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Maya (mayaSpecific)', () => {
    it('should format Maya gas info with zero gas', () => {
      const chainSpecific = {
        case: 'mayaSpecific' as const,
        value: {
          accountNumber: BigInt(123),
          sequence: BigInt(45),
          isDeposit: false,
        },
      }

      const result = formatGasInfo(chainSpecific, 'Maya')

      expect(result).toEqual({
        chainId: 'Maya',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Solana (solanaSpecific)', () => {
    it('should format Solana gas info with priority fee', () => {
      const chainSpecific = {
        case: 'solanaSpecific' as const,
        value: {
          recentBlockHash: 'hash123',
          priorityFee: '5000', // in lamports
        },
      }

      const result = formatGasInfo(chainSpecific, 'Solana')

      expect(result).toEqual({
        chainId: 'Solana',
        gasPrice: '5000',
        priorityFee: '5000',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle zero priority fee', () => {
      const chainSpecific = {
        case: 'solanaSpecific' as const,
        value: {
          recentBlockHash: 'hash123',
          priorityFee: '0',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Solana')

      expect(result.gasPrice).toBe('0')
      expect(result.priorityFee).toBe('0')
    })

    it('should handle high priority fees (congestion)', () => {
      const chainSpecific = {
        case: 'solanaSpecific' as const,
        value: {
          recentBlockHash: 'hash123',
          priorityFee: '1000000', // 1M lamports
        },
      }

      const result = formatGasInfo(chainSpecific, 'Solana')

      expect(result.priorityFee).toBe('1000000')
    })
  })

  describe('Sui (suicheSpecific)', () => {
    it('should format Sui gas info with reference gas price', () => {
      const chainSpecific = {
        case: 'suicheSpecific' as const,
        value: {
          referenceGasPrice: BigInt(1000),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Sui')

      expect(result).toEqual({
        chainId: 'Sui',
        gasPrice: '1000',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle very low gas prices', () => {
      const chainSpecific = {
        case: 'suicheSpecific' as const,
        value: {
          referenceGasPrice: BigInt(1),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Sui')

      expect(result.gasPrice).toBe('1')
    })
  })

  describe('Polkadot (polkadotSpecific)', () => {
    it('should format Polkadot gas info with zero gas (weight-based)', () => {
      const chainSpecific = {
        case: 'polkadotSpecific' as const,
        value: {
          recentBlockHash: 'hash123',
          nonce: BigInt(10),
          currentBlockNumber: BigInt(1000000),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Polkadot')

      expect(result).toEqual({
        chainId: 'Polkadot',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('TON (tonSpecific)', () => {
    it('should format TON gas info with zero gas (dynamic calculation)', () => {
      const chainSpecific = {
        case: 'tonSpecific' as const,
        value: {
          sequenceNumber: 123,
          expireAt: 1700000000,
          bounceable: true,
        },
      }

      const result = formatGasInfo(chainSpecific, 'TON')

      expect(result).toEqual({
        chainId: 'TON',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Tron (tronSpecific)', () => {
    it('should format Tron gas info with zero gas (energy/bandwidth)', () => {
      const chainSpecific = {
        case: 'tronSpecific' as const,
        value: {
          latestBlockId: 'block123',
          expiration: BigInt(1700000000),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Tron')

      expect(result).toEqual({
        chainId: 'Tron',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Ripple (rippleSpecific)', () => {
    it('should format Ripple gas info with gas field', () => {
      const chainSpecific = {
        case: 'rippleSpecific' as const,
        value: {
          gas: BigInt(12), // 12 drops
          sequence: BigInt(100),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ripple')

      expect(result).toEqual({
        chainId: 'Ripple',
        gasPrice: '12',
        lastUpdated: mockTimestamp,
      })
    })

    it('should handle minimum gas (10 drops)', () => {
      const chainSpecific = {
        case: 'rippleSpecific' as const,
        value: {
          gas: BigInt(10),
          sequence: BigInt(0),
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ripple')

      expect(result.gasPrice).toBe('10')
    })
  })

  describe('Cardano (cardano)', () => {
    it('should format Cardano gas info with zero gas (ADA-based fees)', () => {
      const chainSpecific = {
        case: 'cardano' as const,
        value: {
          fromAddress: 'addr_test123',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Cardano')

      expect(result).toEqual({
        chainId: 'Cardano',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Fallback (unknown chain types)', () => {
    it('should return zero gas for undefined case', () => {
      // Create a chainSpecific with no case set
      const chainSpecific = {
        case: undefined,
      } as any

      const result = formatGasInfo(chainSpecific, 'UnknownChain')

      expect(result).toEqual({
        chainId: 'UnknownChain',
        gasPrice: '0',
        lastUpdated: mockTimestamp,
      })
    })
  })

  describe('Timestamp Validation', () => {
    it('should include current timestamp in lastUpdated', () => {
      const chainSpecific = {
        case: 'ethereumSpecific' as const,
        value: {
          maxFeePerGasWei: '50000000000',
          priorityFee: '2000000000',
          nonce: BigInt(0),
          gasLimit: '21000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ethereum')

      expect(result.lastUpdated).toBe(mockTimestamp)
      expect(typeof result.lastUpdated).toBe('number')
    })
  })

  describe('Type Safety', () => {
    it('should return GasInfo type with all required fields', () => {
      const chainSpecific = {
        case: 'utxoSpecific' as const,
        value: {
          byteFee: '10',
          sendMaxAmount: false,
        },
      }

      const result = formatGasInfo(chainSpecific, 'Bitcoin')

      // Verify required GasInfo fields
      expect(result).toHaveProperty('chainId')
      expect(result).toHaveProperty('gasPrice')
      expect(result).toHaveProperty('lastUpdated')
      expect(typeof result.chainId).toBe('string')
      expect(typeof result.gasPrice).toBe('string')
      expect(typeof result.lastUpdated).toBe('number')
    })

    it('should include optional fields for EVM chains', () => {
      const chainSpecific = {
        case: 'ethereumSpecific' as const,
        value: {
          maxFeePerGasWei: '50000000000',
          priorityFee: '2000000000',
          nonce: BigInt(0),
          gasLimit: '21000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Ethereum')

      expect(result).toHaveProperty('gasPriceGwei')
      expect(result).toHaveProperty('maxFeePerGas')
      expect(result).toHaveProperty('priorityFee')
    })

    it('should include priorityFee for Solana', () => {
      const chainSpecific = {
        case: 'solanaSpecific' as const,
        value: {
          recentBlockHash: 'hash123',
          priorityFee: '5000',
        },
      }

      const result = formatGasInfo(chainSpecific, 'Solana')

      expect(result).toHaveProperty('priorityFee')
      expect(result.priorityFee).toBe('5000')
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock core modules BEFORE imports
vi.mock('@core/chain/ChainKind', () => ({
  getChainKind: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/tx/simulation', () => ({
  getTxBlockaidSimulation: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/tx/simulation/input', () => ({
  getBlockaidTxSimulationInput: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/tx/validation', () => ({
  getTxBlockaidValidation: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/tx/validation/api/core', () => ({
  parseBlockaidValidation: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/tx/validation/input', () => ({
  getBlockaidTxValidationInput: vi.fn(),
}))

vi.mock('@core/mpc/keysign/utils/getKeysignChain', () => ({
  getKeysignChain: vi.fn(),
}))

import { getChainKind } from '@core/chain/ChainKind'
import { getTxBlockaidSimulation } from '@core/chain/security/blockaid/tx/simulation'
import { getBlockaidTxSimulationInput } from '@core/chain/security/blockaid/tx/simulation/input'
import { getTxBlockaidValidation } from '@core/chain/security/blockaid/tx/validation'
import { parseBlockaidValidation } from '@core/chain/security/blockaid/tx/validation/api/core'
import { getBlockaidTxValidationInput } from '@core/chain/security/blockaid/tx/validation/input'
import { getKeysignChain } from '@core/mpc/keysign/utils/getKeysignChain'

import { SecurityService } from '../../../../src/vault/services/SecurityService'

describe('SecurityService', () => {
  let service: SecurityService
  const mockWalletCore = { version: 'test' }
  const mockWasmProvider = {
    getWalletCore: vi.fn().mockResolvedValue(mockWalletCore),
  }
  const mockKeysignPayload = { coin: { chain: 'Ethereum' } } as any

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SecurityService(mockWasmProvider as any)
  })

  describe('validateTransaction', () => {
    it('should return validation result for supported chains', async () => {
      vi.mocked(getBlockaidTxValidationInput).mockReturnValue({
        chain: 'Ethereum',
        data: { tx: '0x...' },
      } as any)
      vi.mocked(getTxBlockaidValidation).mockResolvedValue({
        description: 'Token approval to known DEX',
        features: [{ description: 'Uniswap V3 router' }],
        extended_features: [{ description: 'Standard approval' }],
      } as any)
      vi.mocked(parseBlockaidValidation).mockReturnValue(null) // not risky

      const result = await service.validateTransaction(mockKeysignPayload)

      expect(result).toEqual({
        isRisky: false,
        riskLevel: null,
        description: 'Token approval to known DEX',
        features: ['Uniswap V3 router', 'Standard approval'],
      })
    })

    it('should return risky result when validation detects risk', async () => {
      vi.mocked(getBlockaidTxValidationInput).mockReturnValue({
        chain: 'Ethereum',
        data: {},
      } as any)
      vi.mocked(getTxBlockaidValidation).mockResolvedValue({
        description: 'Suspicious contract interaction',
        features: [{ description: 'Unlimited token approval' }],
      } as any)
      vi.mocked(parseBlockaidValidation).mockReturnValue({ level: 'high' } as any)

      const result = await service.validateTransaction(mockKeysignPayload)

      expect(result).not.toBeNull()
      expect(result!.isRisky).toBe(true)
      expect(result!.riskLevel).toBe('high')
      expect(result!.features).toContain('Unlimited token approval')
    })

    it('should return null for unsupported chains', async () => {
      vi.mocked(getBlockaidTxValidationInput).mockReturnValue(null)

      const result = await service.validateTransaction(mockKeysignPayload)

      expect(result).toBeNull()
    })

    it('should pass walletCore to input resolver', async () => {
      vi.mocked(getBlockaidTxValidationInput).mockReturnValue(null)

      await service.validateTransaction(mockKeysignPayload)

      expect(mockWasmProvider.getWalletCore).toHaveBeenCalled()
      expect(getBlockaidTxValidationInput).toHaveBeenCalledWith({
        payload: mockKeysignPayload,
        walletCore: mockWalletCore,
      })
    })

    it('should handle missing features and extended_features', async () => {
      vi.mocked(getBlockaidTxValidationInput).mockReturnValue({
        chain: 'Ethereum',
        data: {},
      } as any)
      vi.mocked(getTxBlockaidValidation).mockResolvedValue({
        description: 'Simple transfer',
      } as any)
      vi.mocked(parseBlockaidValidation).mockReturnValue(null)

      const result = await service.validateTransaction(mockKeysignPayload)

      expect(result!.features).toEqual([])
    })
  })

  describe('simulateTransaction', () => {
    it('should return simulation result for supported chains', async () => {
      const mockSimulation = {
        asset_changes: [{ type: 'transfer', amount: '1.0' }],
      }

      vi.mocked(getBlockaidTxSimulationInput).mockReturnValue({
        chain: 'Ethereum',
        data: { tx: '0x...' },
      } as any)
      vi.mocked(getTxBlockaidSimulation).mockResolvedValue(mockSimulation as any)
      vi.mocked(getKeysignChain).mockReturnValue('Ethereum' as any)
      vi.mocked(getChainKind).mockReturnValue('evm' as any)

      const result = await service.simulateTransaction(mockKeysignPayload)

      expect(result).toEqual({
        chainKind: 'evm',
        simulation: mockSimulation,
      })
    })

    it('should return null for unsupported chains', async () => {
      vi.mocked(getBlockaidTxSimulationInput).mockReturnValue(null)

      const result = await service.simulateTransaction(mockKeysignPayload)

      expect(result).toBeNull()
    })

    it('should determine chain kind from keysign payload', async () => {
      vi.mocked(getBlockaidTxSimulationInput).mockReturnValue({
        chain: 'Solana',
        data: {},
      } as any)
      vi.mocked(getTxBlockaidSimulation).mockResolvedValue({} as any)
      vi.mocked(getKeysignChain).mockReturnValue('Solana' as any)
      vi.mocked(getChainKind).mockReturnValue('solana' as any)

      const result = await service.simulateTransaction(mockKeysignPayload)

      expect(result!.chainKind).toBe('solana')
      expect(getKeysignChain).toHaveBeenCalledWith(mockKeysignPayload)
      expect(getChainKind).toHaveBeenCalledWith('Solana')
    })

    it('should pass walletCore to simulation input resolver', async () => {
      vi.mocked(getBlockaidTxSimulationInput).mockReturnValue(null)

      await service.simulateTransaction(mockKeysignPayload)

      expect(mockWasmProvider.getWalletCore).toHaveBeenCalled()
      expect(getBlockaidTxSimulationInput).toHaveBeenCalledWith({
        payload: mockKeysignPayload,
        walletCore: mockWalletCore,
      })
    })
  })
})

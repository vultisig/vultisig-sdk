/**
 * SigningProgress Tests
 * Tests for SigningStep progress reporting during transaction signing
 *
 * TESTING STRATEGY: Validates that the signing flow properly reports
 * progress at each step using the SigningStep interface
 *
 * Test Coverage:
 * - Progress callback is called at each signing step
 * - All expected steps are reported (preparing, coordinating, signing, complete)
 * - Progress values increase monotonically
 * - Participant counts are tracked correctly
 * - Messages are descriptive and helpful
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerManager } from '../../../src/server/ServerManager'
import { FastSigningService } from '../../../src/services/FastSigningService'
import type { SigningStep } from '../../../src/types'

// Mock ServerManager methods
vi.mock('../../../src/server/ServerManager', () => {
  return {
    ServerManager: vi.fn().mockImplementation(() => ({
      coordinateFastSigning: vi.fn().mockImplementation(async options => {
        // Simulate progress reporting
        if (options.onProgress) {
          options.onProgress({
            step: 'coordinating',
            progress: 30,
            message: 'Connecting to VultiServer...',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 1,
          })
          options.onProgress({
            step: 'coordinating',
            progress: 50,
            message: 'Waiting for all participants...',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 1,
          })
          options.onProgress({
            step: 'coordinating',
            progress: 60,
            message: 'All participants ready...',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 2,
          })
          options.onProgress({
            step: 'signing',
            progress: 70,
            message: 'Performing cryptographic signing...',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 2,
          })
          options.onProgress({
            step: 'complete',
            progress: 90,
            message: 'Formatting signature...',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 2,
          })
          options.onProgress({
            step: 'complete',
            progress: 100,
            message: 'Signature complete',
            mode: 'fast',
            participantCount: 2,
            participantsReady: 2,
          })
        }

        // Return mock signature
        return {
          signature: 'mock_signature',
          format: 'ECDSA',
        }
      }),
    })),
  }
})

describe('SigningProgress', () => {
  let fastSigningService: FastSigningService
  let mockServerManager: ServerManager
  let mockVault: any

  beforeEach(() => {
    // Create mock dependencies
    mockServerManager = new ServerManager()

    fastSigningService = new FastSigningService(mockServerManager)

    // Create mock vault with server signer (fast vault)
    mockVault = {
      name: 'Test Fast Vault',
      publicKeys: {
        ecdsa: '02test_ecdsa_key',
        eddsa: 'test_eddsa_key',
      },
      signers: ['local-1', 'Server-1'], // Has Server- signer
      keyShares: {
        ecdsa: 'mock_ecdsa_keyshare',
        eddsa: 'mock_eddsa_keyshare',
      },
      hexChainCode: 'test_chain_code',
      localPartyId: 'local-1',
      resharePrefix: '',
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now(),
    }
  })

  describe('signWithServer', () => {
    it('should report all SigningStep phases', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {
          /* mock tx data */
        },
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'], // Pre-computed hash
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify all expected steps were reported
      const reportedSteps = progressSteps.map(s => s.step)
      expect(reportedSteps).toContain('preparing')
      expect(reportedSteps).toContain('coordinating')
      expect(reportedSteps).toContain('signing')
      expect(reportedSteps).toContain('complete')

      // Verify onProgress was called
      expect(onProgress).toHaveBeenCalled()
    })

    it('should report increasing progress values', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify progress values are monotonically increasing
      const progressValues = progressSteps.map(s => s.progress)
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1])
      }

      // Verify final progress is 100%
      const finalStep = progressSteps[progressSteps.length - 1]
      expect(finalStep.progress).toBe(100)
      expect(finalStep.step).toBe('complete')
    })

    it('should track participant counts correctly', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify all steps report participant information
      progressSteps.forEach(step => {
        expect(step.participantCount).toBe(2) // Fast vault = 2 participants
        expect(step.participantsReady).toBeGreaterThanOrEqual(0)
        expect(step.participantsReady).toBeLessThanOrEqual(2)
      })

      // Verify participants ready increases over time
      const coordinatingSteps = progressSteps.filter(s => s.step === 'coordinating')
      if (coordinatingSteps.length > 1) {
        expect(coordinatingSteps[coordinatingSteps.length - 1].participantsReady).toBeGreaterThanOrEqual(
          coordinatingSteps[0].participantsReady!
        )
      }
    })

    it('should provide descriptive messages at each step', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify all steps have descriptive messages
      progressSteps.forEach(step => {
        expect(step.message).toBeDefined()
        expect(typeof step.message).toBe('string')
        expect(step.message.length).toBeGreaterThan(0)
      })
    })

    it('should include signing mode in all progress updates', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify all steps include mode
      progressSteps.forEach(step => {
        expect(step.mode).toBe('fast')
      })
    })

    it('should work without onProgress callback', async () => {
      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      // Should not throw when onProgress is not provided
      await expect(fastSigningService.signWithServer(mockVault, payload, 'test_password')).resolves.toBeDefined()
    })

    it('should throw error if messageHashes are missing', async () => {
      const onProgress = vi.fn()

      const payload = {
        transaction: {},
        chain: 'ethereum',
        // messageHashes missing
      }

      await expect(
        fastSigningService.signWithServer(mockVault, payload as any, 'test_password', onProgress)
      ).rejects.toThrow('SigningPayload must include pre-computed messageHashes')
    })

    it('should report preparing step before coordinating', async () => {
      const progressSteps: SigningStep[] = []
      const onProgress = vi.fn((step: SigningStep) => {
        progressSteps.push(step)
      })

      const payload = {
        transaction: {},
        chain: 'ethereum',
        messageHashes: ['0xabcd1234'],
      }

      await fastSigningService.signWithServer(mockVault, payload, 'test_password', onProgress)

      // Verify first step is preparing
      expect(progressSteps[0].step).toBe('preparing')
      expect(progressSteps[0].progress).toBe(0)

      // Find index of first coordinating step
      const coordinatingIndex = progressSteps.findIndex(s => s.step === 'coordinating')
      expect(coordinatingIndex).toBeGreaterThan(0)
    })
  })
})

import { getChainKind } from '@core/chain/ChainKind'
import { getTxBlockaidSimulation } from '@core/chain/security/blockaid/tx/simulation'
import { getBlockaidTxSimulationInput } from '@core/chain/security/blockaid/tx/simulation/input'
import { getTxBlockaidValidation } from '@core/chain/security/blockaid/tx/validation'
import { parseBlockaidValidation } from '@core/chain/security/blockaid/tx/validation/api/core'
import { getBlockaidTxValidationInput } from '@core/chain/security/blockaid/tx/validation/input'
import { getKeysignChain } from '@core/mpc/keysign/utils/getKeysignChain'
import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

import type { VaultContext } from '../../context/SdkContext'
import type { TransactionSimulationResult, TransactionValidationResult } from '../../types/security'

export class SecurityService {
  constructor(private wasmProvider: VaultContext['wasmProvider']) {}

  async validateTransaction(keysignPayload: KeysignPayload): Promise<TransactionValidationResult | null> {
    const walletCore = await this.wasmProvider.getWalletCore()

    // Build chain-specific input (returns null if chain unsupported)
    const input = getBlockaidTxValidationInput({
      payload: keysignPayload,
      walletCore,
    })
    if (!input) return null

    // Call Blockaid API
    const validation = await getTxBlockaidValidation(input)
    const parsed = parseBlockaidValidation(validation)

    // Map to SDK-owned type
    return {
      isRisky: parsed !== null,
      riskLevel: parsed?.level ?? null,
      description: validation.description,
      features: [
        ...(validation.features?.map(f => f.description) ?? []),
        ...(validation.extended_features?.map(f => f.description) ?? []),
      ],
    }
  }

  async simulateTransaction(keysignPayload: KeysignPayload): Promise<TransactionSimulationResult | null> {
    const walletCore = await this.wasmProvider.getWalletCore()

    // Build chain-specific input (returns null if chain unsupported)
    const input = getBlockaidTxSimulationInput({
      payload: keysignPayload,
      walletCore,
    })
    if (!input) return null

    // Call Blockaid API
    const simulation = await getTxBlockaidSimulation(input as any)

    // Determine chain kind from the keysign payload
    const chain = getKeysignChain(keysignPayload)
    const chainKind = getChainKind(chain)

    return {
      chainKind: chainKind as 'evm' | 'solana',
      simulation,
    }
  }
}

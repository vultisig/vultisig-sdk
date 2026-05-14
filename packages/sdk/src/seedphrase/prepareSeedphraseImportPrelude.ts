import type { Chain } from '@vultisig/core-chain/Chain'

import { DEFAULT_CHAINS } from '../constants'
import type { VaultCreationStep } from '../types'
import { VaultError, VaultErrorCode } from '../vault/VaultError'
import type { ChainDiscoveryService } from './ChainDiscoveryService'
import type { MasterKeyDeriver } from './MasterKeyDeriver'
import type { SeedphraseValidator } from './SeedphraseValidator'
import type { ChainDiscoveryProgress, ChainDiscoveryResult, DerivedMasterKeys } from './types'

export type SeedphraseImportPreludeProgressLabels = {
  validating: Pick<VaultCreationStep, 'progress' | 'message'>
  derivingKeys: Pick<VaultCreationStep, 'progress' | 'message'>
  discoveringChains: Pick<VaultCreationStep, 'progress' | 'message'>
}

export type SeedphraseImportPreludeInput = {
  mnemonic: string
  discoverChains?: boolean
  chains?: Chain[]
  chainsToScan?: Chain[]
  usePhantomSolanaPath?: boolean
  onChainDiscovery?: (progress: ChainDiscoveryProgress) => void
  validator: SeedphraseValidator
  keyDeriver: MasterKeyDeriver
  discoveryService: ChainDiscoveryService
  reportProgress: (step: VaultCreationStep) => void
  progressLabels: SeedphraseImportPreludeProgressLabels
}

export type SeedphraseImportPreludeResult = {
  masterKeys: DerivedMasterKeys
  discoveredChains: ChainDiscoveryResult[] | undefined
  usePhantomSolanaPath: boolean
  chainsToImport: Chain[]
}

/**
 * Shared validation, master-key derivation, optional chain discovery, Phantom path selection,
 * and `chainsToImport` resolution for seedphrase-based vault creation (secure + fast).
 */
export async function prepareSeedphraseImportPrelude(
  input: SeedphraseImportPreludeInput
): Promise<SeedphraseImportPreludeResult> {
  const {
    mnemonic,
    discoverChains,
    chains,
    chainsToScan,
    usePhantomSolanaPath: explicitPhantomPath,
    onChainDiscovery,
    validator,
    keyDeriver,
    discoveryService,
    reportProgress,
    progressLabels,
  } = input

  reportProgress({
    step: 'initializing',
    ...progressLabels.validating,
  })

  const validation = await validator.validate(mnemonic)
  if (!validation.valid) {
    throw new VaultError(VaultErrorCode.InvalidConfig, `Invalid mnemonic: ${validation.error}`)
  }

  reportProgress({
    step: 'initializing',
    ...progressLabels.derivingKeys,
  })

  const masterKeys = await keyDeriver.deriveMasterKeys(mnemonic)

  let discoveredChains: ChainDiscoveryResult[] | undefined
  let usePhantomSolanaPath = explicitPhantomPath ?? false

  if (discoverChains) {
    reportProgress({
      step: 'fetching_balances',
      ...progressLabels.discoveringChains,
    })

    const discoveryResult = await discoveryService.discoverChains(mnemonic, {
      config: { chains: chainsToScan },
      onProgress: onChainDiscovery,
    })
    discoveredChains = discoveryResult.results
    if (explicitPhantomPath === undefined) {
      usePhantomSolanaPath = discoveryResult.usePhantomSolanaPath
    }
  }

  const chainsToImport = chains ?? discoveredChains?.filter(c => c.hasBalance).map(c => c.chain) ?? DEFAULT_CHAINS

  return {
    masterKeys,
    discoveredChains,
    usePhantomSolanaPath,
    chainsToImport,
  }
}

import type { Chain } from '@vultisig/core-chain/Chain'

import { assertSeedphraseImportSupportsChains, DEFAULT_CHAINS } from '../constants'
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
  useCosmosPathTerra?: boolean
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
  useCosmosPathTerra: boolean
  chainsToImport: Chain[]
}

/**
 * Shared validation, master-key derivation, optional chain discovery, Phantom path selection,
 * Cosmos-path Terra detection, and `chainsToImport` resolution for seedphrase-based vault creation.
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
    useCosmosPathTerra: explicitCosmosPathTerra,
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

  let discoveredChains: ChainDiscoveryResult[] | undefined
  let usePhantomSolanaPath = explicitPhantomPath ?? false
  let useCosmosPathTerra = explicitCosmosPathTerra ?? false

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
    if (explicitCosmosPathTerra === undefined) {
      useCosmosPathTerra = discoveryResult.useCosmosPathTerra
    }
  }

  const chainsToImport = chains ?? discoveredChains?.filter(c => c.hasBalance).map(c => c.chain) ?? DEFAULT_CHAINS
  assertSeedphraseImportSupportsChains(chainsToImport)

  reportProgress({
    step: 'initializing',
    ...progressLabels.derivingKeys,
  })

  const masterKeys = await keyDeriver.deriveMasterKeys(mnemonic)

  return {
    masterKeys,
    discoveredChains,
    usePhantomSolanaPath,
    useCosmosPathTerra,
    chainsToImport,
  }
}

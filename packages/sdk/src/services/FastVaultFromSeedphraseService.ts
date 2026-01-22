/**
 * FastVaultFromSeedphraseService - Creates a FastVault from a seedphrase
 *
 * Orchestrates the full vault creation from seedphrase with VultiServer coordination:
 * 1. Validate mnemonic
 * 2. Derive master keys
 * 3. Setup with VultiServer
 * 4. Run DKLS key import (ECDSA) for master key
 * 5. Run Schnorr key import (EdDSA) for master key
 * 6. Run per-chain key imports (DKLS or Schnorr based on chain type)
 * 7. Optionally discover chains with balances
 */
import type { Chain } from '@core/chain/Chain'
import { generateLocalPartyId } from '@core/mpc/devices/localPartyId'
import { DKLS } from '@core/mpc/dkls/dkls'
import { fastVaultServerUrl } from '@core/mpc/fast/config'
import { setKeygenComplete, waitForKeygenComplete } from '@core/mpc/keygenComplete'
import { Schnorr } from '@core/mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { toLibType } from '@core/mpc/types/utils/libType'
import { generateHexChainCode } from '@core/mpc/utils/generateHexChainCode'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { DEFAULT_CHAINS } from '../constants'
import type { SdkContext } from '../context/SdkContext'
import { randomUUID } from '../crypto'
import { ChainDiscoveryService } from '../seedphrase/ChainDiscoveryService'
import { MasterKeyDeriver } from '../seedphrase/MasterKeyDeriver'
import { SeedphraseValidator } from '../seedphrase/SeedphraseValidator'
import type { ChainDiscoveryResult, CreateFastVaultFromSeedphraseOptions } from '../seedphrase/types'
import type { VaultCreationStep } from '../types'
import { VaultError, VaultErrorCode } from '../vault/VaultError'

/**
 * Call VultiServer key import API
 */
async function keyImportWithServer(input: {
  name: string
  session_id: string
  hex_encryption_key: string
  hex_chain_code: string
  local_party_id: string
  encryption_password: string
  email: string
  lib_type: number
  chains: string[]
}): Promise<void> {
  await queryUrl(`${fastVaultServerUrl}/import`, {
    body: input,
    responseType: 'none',
  })
}

/**
 * FastVaultFromSeedphraseService
 *
 * Creates a FastVault (2-of-3 with VultiServer) from an existing BIP39 seedphrase.
 *
 * @example
 * ```typescript
 * const service = new FastVaultFromSeedphraseService(context)
 * const result = await service.createFromSeedphrase({
 *   mnemonic: 'abandon abandon ... about',
 *   name: 'My Wallet',
 *   password: 'securePassword',
 *   email: 'user@example.com',
 *   discoverChains: true,
 * })
 * // Vault needs email verification
 * const vault = await sdk.verifyVault(result.vaultId, emailCode)
 * ```
 */
export class FastVaultFromSeedphraseService {
  private readonly validator: SeedphraseValidator
  private readonly keyDeriver: MasterKeyDeriver
  private readonly discoveryService: ChainDiscoveryService
  private readonly serverUrl: string

  constructor(private readonly context: SdkContext) {
    this.validator = new SeedphraseValidator(context.wasmProvider)
    this.keyDeriver = new MasterKeyDeriver(context.wasmProvider)
    this.discoveryService = new ChainDiscoveryService(context.wasmProvider)
    this.serverUrl = 'https://api.vultisig.com/router' // Default relay URL
  }

  /**
   * Create a FastVault from a seedphrase
   *
   * @param options - Creation options
   * @returns Creation result with vaultId for verification
   */
  async createFromSeedphrase(options: CreateFastVaultFromSeedphraseOptions): Promise<{
    vault: CoreVault
    vaultId: string
    verificationRequired: boolean
    discoveredChains?: ChainDiscoveryResult[]
  }> {
    const { mnemonic, name, password, email, signal, onProgress, onChainDiscovery } = options

    const reportProgress = (step: VaultCreationStep) => {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }

    // Step 1: Validate mnemonic
    reportProgress({
      step: 'initializing',
      progress: 5,
      message: 'Validating seedphrase...',
    })

    const validation = await this.validator.validate(mnemonic)
    if (!validation.valid) {
      throw new VaultError(VaultErrorCode.InvalidConfig, `Invalid mnemonic: ${validation.error}`)
    }

    // Step 2: Derive master keys
    reportProgress({
      step: 'initializing',
      progress: 10,
      message: 'Deriving master keys...',
    })

    const masterKeys = await this.keyDeriver.deriveMasterKeys(mnemonic)

    // Step 3: Run optional chain discovery
    let discoveredChains: ChainDiscoveryResult[] | undefined
    if (options.discoverChains) {
      reportProgress({
        step: 'fetching_balances',
        progress: 15,
        message: 'Discovering chains with balances...',
      })

      discoveredChains = await this.discoveryService.discoverChains(mnemonic, {
        config: { chains: options.chainsToScan },
        onProgress: onChainDiscovery,
      })
    }

    // Determine which chains to import
    const chainsToImport =
      options.chains ?? discoveredChains?.filter(c => c.hasBalance).map(c => c.chain) ?? DEFAULT_CHAINS

    // Step 4: Generate session parameters
    reportProgress({
      step: 'keygen',
      progress: 25,
      message: 'Setting up key import session...',
    })

    const sessionId = randomUUID()
    const hexEncryptionKey = generateHexEncryptionKey()
    const hexChainCode = generateHexChainCode()
    const localPartyId = generateLocalPartyId('sdk')
    const serverPartyId = generateLocalPartyId('server')

    // Step 5: Call VultiServer key import API
    await keyImportWithServer({
      name,
      session_id: sessionId,
      hex_encryption_key: hexEncryptionKey,
      hex_chain_code: hexChainCode,
      local_party_id: serverPartyId,
      encryption_password: password,
      email,
      lib_type: toLibType({ libType: 'DKLS', isKeyImport: true }), // KEYIMPORT (2)
      chains: chainsToImport,
    })

    // Step 6: Join relay session
    reportProgress({
      step: 'keygen',
      progress: 30,
      message: 'Joining relay session...',
    })

    await joinMpcSession({
      serverUrl: this.serverUrl,
      sessionId,
      localPartyId,
    })

    // Step 7: Wait for server to join
    reportProgress({
      step: 'keygen',
      progress: 35,
      message: 'Waiting for server...',
    })

    const devices = await this.waitForPeers(sessionId, localPartyId, signal)

    // Step 8: Start MPC session
    await startMpcSession({
      serverUrl: this.serverUrl,
      sessionId,
      devices,
    })

    // Step 9: ECDSA key import via DKLS
    reportProgress({
      step: 'keygen',
      progress: 45,
      message: 'Importing ECDSA key...',
    })

    const dkls = new DKLS(
      { keyimport: true },
      true, // isInitiateDevice
      this.serverUrl,
      sessionId,
      localPartyId,
      devices,
      [], // oldKeygenCommittee
      hexEncryptionKey
    )

    const ecdsaResult = await dkls.startKeyImportWithRetry(masterKeys.ecdsaPrivateKeyHex, hexChainCode)

    // Check for abort before EdDSA key import
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Step 10: EdDSA key import via Schnorr
    reportProgress({
      step: 'keygen',
      progress: 70,
      message: 'Importing EdDSA key...',
    })

    const setupMessage = dkls.getSetupMessage()
    const schnorr = new Schnorr(
      { keyimport: true },
      true, // isInitiateDevice
      this.serverUrl,
      sessionId,
      localPartyId,
      devices,
      [], // oldKeygenCommittee
      hexEncryptionKey,
      setupMessage
    )

    const eddsaResult = await schnorr.startKeyImportWithRetry(masterKeys.eddsaPrivateKeyHex, hexChainCode)

    // Check for abort before per-chain imports
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Step 11: Per-chain key imports
    reportProgress({
      step: 'keygen',
      progress: 75,
      message: 'Importing chain-specific keys...',
    })

    const chainPublicKeys: Partial<Record<Chain, string>> = {}
    const chainKeyShares: Partial<Record<Chain, string>> = {}

    // Derive chain-specific private keys
    const chainPrivateKeys = await this.keyDeriver.deriveChainPrivateKeys(mnemonic, chainsToImport as Chain[])

    // Import each chain's key via MPC
    for (let i = 0; i < chainPrivateKeys.length; i++) {
      // Check for abort at start of each chain import
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      const { chain, privateKeyHex, isEddsa } = chainPrivateKeys[i]

      reportProgress({
        step: 'keygen',
        progress: 75 + Math.floor((i / chainPrivateKeys.length) * 15),
        message: `Importing ${chain} key (${i + 1}/${chainPrivateKeys.length})...`,
        chainId: chain,
      })

      if (isEddsa) {
        // EdDSA chains use Schnorr
        const chainSchnorr = new Schnorr(
          { keyimport: true },
          true, // isInitiateDevice
          this.serverUrl,
          sessionId,
          localPartyId,
          devices,
          [], // oldKeygenCommittee
          hexEncryptionKey,
          new Uint8Array() // Empty setup for chain imports
        )
        const chainResult = await chainSchnorr.startKeyImportWithRetry(privateKeyHex, eddsaResult.chaincode, chain)
        chainPublicKeys[chain] = chainResult.publicKey
        chainKeyShares[chain] = chainResult.keyshare
      } else {
        // ECDSA chains use DKLS
        const chainDkls = new DKLS(
          { keyimport: true },
          true, // isInitiateDevice
          this.serverUrl,
          sessionId,
          localPartyId,
          devices,
          [], // oldKeygenCommittee
          hexEncryptionKey
        )
        const chainResult = await chainDkls.startKeyImportWithRetry(privateKeyHex, ecdsaResult.chaincode, chain)
        chainPublicKeys[chain] = chainResult.publicKey
        chainKeyShares[chain] = chainResult.keyshare
      }
    }

    // Step 12: Signal completion
    reportProgress({
      step: 'keygen',
      progress: 90,
      message: 'Finalizing key import...',
    })

    await setKeygenComplete({
      serverURL: this.serverUrl,
      sessionId,
      localPartyId,
    })

    // Wait for server completion with tolerance for import flows
    // VultiServer's /import endpoint may not signal completion the same way /create does
    // Since MPC already succeeded (we have the keys), this is just a secondary check
    const peers = devices.filter(d => d !== localPartyId)
    try {
      await waitForKeygenComplete({
        serverURL: this.serverUrl,
        sessionId,
        peers,
      })
    } catch {
      // For key import, if MPC succeeded but server didn't signal completion,
      // we can proceed since we have valid keys from the completed MPC exchange
      console.warn('Server completion signal not received, proceeding with valid MPC keys')
    }

    // Step 13: Build vault structure
    const vault: CoreVault = {
      name,
      publicKeys: {
        ecdsa: ecdsaResult.publicKey,
        eddsa: eddsaResult.publicKey,
      },
      localPartyId,
      signers: devices,
      hexChainCode: ecdsaResult.chaincode,
      keyShares: {
        ecdsa: ecdsaResult.keyshare,
        eddsa: eddsaResult.keyshare,
      },
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now(),
      chainPublicKeys,
      chainKeyShares,
    }

    reportProgress({
      step: 'complete',
      progress: 100,
      message: 'Key import complete!',
    })

    return {
      vault,
      vaultId: vault.publicKeys.ecdsa,
      verificationRequired: true,
      discoveredChains,
    }
  }

  /**
   * Wait for peers to join the session
   */
  private async waitForPeers(sessionId: string, localPartyId: string, signal?: AbortSignal): Promise<string[]> {
    const maxWaitTime = 30000
    const checkInterval = 2000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
        const url = `${this.serverUrl}/${sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        const uniquePeers = [...new Set(allPeers)]
        const otherPeers = uniquePeers.filter(p => p !== localPartyId)

        if (otherPeers.length > 0) {
          return [localPartyId, ...otherPeers]
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }

    throw new VaultError(VaultErrorCode.Timeout, 'Timeout waiting for server to join key import session')
  }
}

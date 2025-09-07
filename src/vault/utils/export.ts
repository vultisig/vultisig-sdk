import { create, toBinary } from '@bufbuild/protobuf'
import { toCommVault } from '@core/mpc/types/utils/commVault'
import { VaultContainerSchema } from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { Vault } from '@core/ui/vault/Vault'
import { encryptWithAesGcm } from '@lib/utils/encryption/aesGcm/encryptWithAesGcm'

/**
 * Generate export filename based on vault details (DKLS format only)
 */
export const getExportFileName = (vault: Vault): string => {
  const totalSigners = vault.signers.length
  const localPartyIndex = vault.signers.indexOf(vault.localPartyId) + 1
  
  // Always use DKLS share format
  return `${vault.name}-${vault.localPartyId}-share${localPartyIndex}of${totalSigners}.vult`
}

/**
 * Create vault backup data with optional password encryption
 */
export const createVaultBackup = async (vault: Vault, password?: string): Promise<string> => {
  const commVault = toCommVault(vault)
  const vaultData = toBinary(VaultSchema, commVault)

  const vaultContainer = create(VaultContainerSchema, {
    version: BigInt(1),
    vault: Buffer.from(vaultData).toString('base64'),
  })

  if (password) {
    vaultContainer.isEncrypted = true
    const encryptedVault = encryptWithAesGcm({
      key: password,
      value: Buffer.from(vaultData),
    })
    vaultContainer.vault = encryptedVault.toString('base64')
  } else {
    vaultContainer.isEncrypted = false
  }

  const vaultContainerData = toBinary(VaultContainerSchema, vaultContainer)

  return Buffer.from(vaultContainerData).toString('base64')
}

import { create, toBinary } from '@bufbuild/protobuf'
import { toCommVault } from '@vultisig/core-mpc/types/utils/commVault'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { Vault } from '@vultisig/core-mpc/vault/Vault'
import { encryptVaultBackupWithPassword } from '@vultisig/lib-utils/encryption/vaultBackup/encryptVaultBackupWithPassword'

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
    const encryptedVault = encryptVaultBackupWithPassword(password, Buffer.from(vaultData))
    vaultContainer.vault = encryptedVault.toString('base64')
  } else {
    vaultContainer.isEncrypted = false
  }

  const vaultContainerData = toBinary(VaultContainerSchema, vaultContainer)

  return Buffer.from(vaultContainerData).toString('base64')
}

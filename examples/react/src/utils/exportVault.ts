import { createVaultBackup, getExportFileName } from 'vultisig-sdk'

export const buildVultFile = async (vault: any, password?: string) => {
  // Extract raw vault data if it's a Vault class instance
  const vaultData = vault.data || vault
  const base64Data = await createVaultBackup(vaultData, password)
  const filename = getExportFileName(vaultData)
  const blob = new Blob([base64Data], { type: 'text/plain' })
  return { blob, filename }
}

export const buildVultFile = async (vault: any, password?: string) => {
  // Use Vault's public API methods
  const base64Data = await vault.exportAsBase64(password)
  const filename = vault.getExportFileName()
  const blob = new Blob([base64Data], { type: 'text/plain' })
  return { blob, filename }
}

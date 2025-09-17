import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Vultisig } from '../index'

// Mock the file download functionality for testing
vi.mock('@lib/ui/utils/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn()
}))

describe('Vault Export', () => {
  let vultisig: Vultisig
  
  beforeEach(async () => {
    vultisig = new Vultisig()
    await vultisig.clearVaults()
  })

  it('should export imported DKLS vault and generate correct filename', async () => {
    // Import TestFastVault (DKLS type)
    const vaultPath = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
    ;(vaultFile as any).buffer = vaultBuffer
    const vault = await vultisig.addVault(vaultFile, 'Password123!')
    
    // Export without password
    const blob = await vault.export()
    
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/octet-stream')
    expect(blob.size).toBeGreaterThan(0)
    
    // Check that it contains base64 data
    const text = await blob.text()
    expect(text.length).toBeGreaterThan(0)
    expect(typeof text).toBe('string')
    
    // Verify the filename would be generated correctly
    const { getExportFileName } = await import('../vault/utils/export')
    const expectedFilename = getExportFileName(vault.vaultData)
    
    // Based on the vault details: name="TestFastVault", localPartyId="iPhone-5C9", signers=2, libType="DKLS"
    expect(expectedFilename).toBe('TestFastVault-iPhone-5C9-share2of2.vult')
  })

  it('should export imported DKLS vault with password', async () => {
    // Import TestFastVault (DKLS type)
    const vaultPath = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
    ;(vaultFile as any).buffer = vaultBuffer
    const vault = await vultisig.addVault(vaultFile, 'Password123!')
    
    // Export with password
    const password = 'new-export-password'
    const blob = await vault.export(password)
    
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/octet-stream')
    expect(blob.size).toBeGreaterThan(0)
    
    // Check that it contains base64 data
    const text = await blob.text()
    expect(text.length).toBeGreaterThan(0)
    expect(typeof text).toBe('string')
  })

  it('should export imported vault and generate correct filename', async () => {
    // Import TestSecureVault
    const vaultPath = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestSecureVault.vult')
    ;(vaultFile as any).buffer = vaultBuffer
    const vault = await vultisig.addVault(vaultFile)
    
    // Export without password
    const blob = await vault.export()
    
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/octet-stream')
    expect(blob.size).toBeGreaterThan(0)
    
    // Verify the filename would be generated correctly (always uses share format)
    const { getExportFileName } = await import('../vault/utils/export')
    const expectedFilename = getExportFileName(vault.vaultData)
    
    expect(expectedFilename).toContain('TestSecureVault')
    expect(expectedFilename).toContain('MacBook Air-EE5')
    expect(expectedFilename).toContain('share2of2')
    expect(expectedFilename.endsWith('.vult')).toBe(true)
  })

  it('should generate proper filename format', async () => {
    const { getExportFileName } = await import('../vault/utils/export')
    
    const mockVault = {
      name: 'TestVault',
      localPartyId: 'party2',
      signers: ['party1', 'party2']
    }
    
    const filename = getExportFileName(mockVault as any)
    expect(filename).toBe('TestVault-party2-share2of2.vult')
  })
})

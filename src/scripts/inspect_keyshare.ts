#!/usr/bin/env tsx

/**
 * Vultisig Keyshare Inspector Script
 * 
 * This script inspects .vult keyshare files and displays their contents in a readable format.
 * It can handle both encrypted and unencrypted vault files.
 * 
 * Usage:
 *   npx tsx scripts/inspect_keyshare.ts vault.vult                # For unencrypted vaults
 *   npx tsx scripts/inspect_keyshare.ts vault.vult password123   # For encrypted vaults
 */

import { readFileSync, existsSync } from 'fs'
import { fromBinary } from '@bufbuild/protobuf'
import { VaultContainerSchema } from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { fromBase64 } from '@lib/utils/fromBase64'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'

import type { VaultContainer } from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
import type { Vault } from '@core/mpc/types/vultisig/vault/v1/vault_pb'

// Decode VaultContainer using proper protobuf schema
function decodeVaultContainer(buffer: Buffer): VaultContainer {
  return fromBinary(VaultContainerSchema, buffer)
}

// Decode Vault using proper protobuf schema and convert to readable format
function decodeVault(buffer: Buffer) {
  const vaultProtobuf = fromBinary(VaultSchema, buffer)
  
  // Convert protobuf format to readable format
  return {
    name: vaultProtobuf.name,
    publicKeyEcdsa: vaultProtobuf.publicKeyEcdsa,
    publicKeyEddsa: vaultProtobuf.publicKeyEddsa,
    signers: [...vaultProtobuf.signers],
    createdAt: vaultProtobuf.createdAt ? new Date(Number(vaultProtobuf.createdAt.seconds) * 1000) : null,
    hexChainCode: vaultProtobuf.hexChainCode,
    keyShares: vaultProtobuf.keyShares.map(keyShare => ({
      publicKey: keyShare.publicKey,
      keyshare: keyShare.keyshare
    })),
    localPartyId: vaultProtobuf.localPartyId,
    resharePrefix: vaultProtobuf.resharePrefix,
    libType: 'DKLS' // Always DKLS format
  }
}

type VaultInfo = ReturnType<typeof decodeVault>

function formatVaultInfo(vault: VaultInfo, isEncrypted: boolean, password?: string): string {
  const info: string[] = []
  
  info.push('='.repeat(60))
  info.push('VULTISIG KEYSHARE INSPECTION REPORT')
  info.push('='.repeat(60))
  info.push('')
  
  // Encryption status
  info.push(`🔒 Encryption Status: ${isEncrypted ? 'ENCRYPTED' : 'UNENCRYPTED'}`)
  if (isEncrypted && password) {
    info.push(`🔑 Password: ${password}`)
  }
  info.push('')
  
  // Basic vault information
  info.push('📋 VAULT INFORMATION')
  info.push('-'.repeat(30))
  info.push(`Name: ${vault.name || 'N/A'}`)
  info.push(`Local Party ID: ${vault.localPartyId || 'N/A'}`)
  info.push(`Reshare Prefix: ${vault.resharePrefix || 'N/A'}`)
  info.push(`Library Type: ${vault.libType || 'N/A'}`)
  if (vault.createdAt) {
    info.push(`Created At: ${vault.createdAt.toISOString()}`)
  }
  info.push('')
  
  // Public keys
  info.push('🔑 PUBLIC KEYS')
  info.push('-'.repeat(30))
  info.push(`ECDSA: ${vault.publicKeyEcdsa || 'N/A'}`)
  info.push(`EdDSA: ${vault.publicKeyEddsa || 'N/A'}`)
  info.push(`Chain Code: ${vault.hexChainCode || 'N/A'}`)
  info.push('')
  
  // Signers
  info.push('👥 SIGNERS')
  info.push('-'.repeat(30))
  if (vault.signers && vault.signers.length > 0) {
    vault.signers.forEach((signer, index) => {
      info.push(`${index + 1}. ${signer}`)
    })
  } else {
    info.push('No signers found')
  }
  info.push('')
  
  // Key shares
  info.push('🔐 KEY SHARES')
  info.push('-'.repeat(30))
  if (vault.keyShares && vault.keyShares.length > 0) {
    vault.keyShares.forEach((keyShare, index) => {
      info.push(`Share ${index + 1}:`)
      info.push(`  Public Key: ${keyShare.publicKey || 'N/A'}`)
      info.push(`  Key Share: ${keyShare.keyshare ? `${keyShare.keyshare.substring(0, 50)}...` : 'N/A'}`)
      info.push('')
    })
  } else {
    info.push('No key shares found')
  }
  
  // Summary statistics
  info.push('📊 SUMMARY')
  info.push('-'.repeat(30))
  info.push(`Total Signers: ${vault.signers ? vault.signers.length : 0}`)
  info.push(`Total Key Shares: ${vault.keyShares ? vault.keyShares.length : 0}`)
  info.push(`Security Type: ${vault.signers && vault.signers.length === 2 ? 'Fast (2-of-2)' : 'Secure (Multi-party)'}`)
  info.push('')
  
  info.push('='.repeat(60))
  
  return info.join('\n')
}

function main(): void {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/inspect_keyshare.ts <vault.vult> [password]')
    console.error('')
    console.error('Examples:')
    console.error('  npx tsx scripts/inspect_keyshare.ts vault.vult                # Unencrypted vault')
    console.error('  npx tsx scripts/inspect_keyshare.ts vault.vult mypassword123  # Encrypted vault')
    process.exit(1)
  }
  
  const vaultFile = args[0]
  const password = args[1]
  
  // Check if file exists
  if (!existsSync(vaultFile)) {
    console.error(`Error: File '${vaultFile}' not found`)
    process.exit(1)
  }
  
  // Check file extension
  if (!vaultFile.toLowerCase().endsWith('.vult')) {
    console.warn(`Warning: File '${vaultFile}' does not have .vult extension`)
  }
  
  try {
    // Read the file
    const fileContent = readFileSync(vaultFile, 'utf8').trim()
    
    // Decode base64 outer layer using imported utility
    const containerBuffer = fromBase64(fileContent)
    
    // Parse VaultContainer protobuf
    const container = decodeVaultContainer(containerBuffer)
    
    let vaultBuffer: Buffer
    
    if (container.isEncrypted) {
      if (!password) {
        console.error('Error: This vault is encrypted. Please provide a password.')
        console.error(`Usage: npx tsx scripts/inspect_keyshare.ts ${vaultFile} <password>`)
        process.exit(1)
      }
      
      try {
        // Decrypt the vault data using imported utility
        const encryptedData = fromBase64(container.vault)
        const decryptedData = decryptWithAesGcm({
          key: password,
          value: encryptedData
        })
        vaultBuffer = fromBase64(decryptedData.toString('base64'))
      } catch (error) {
        console.error('Error: Failed to decrypt vault. Invalid password or corrupted data.')
        console.error(`Details: ${(error as Error).message}`)
        process.exit(1)
      }
    } else {
      // Unencrypted vault
      if (password) {
        console.warn('Warning: Password provided but vault is not encrypted. Ignoring password.')
      }
      vaultBuffer = fromBase64(container.vault)
    }
    
    // Parse the inner Vault protobuf
    const vault = decodeVault(vaultBuffer)
    
    // Display the formatted information
    console.log(formatVaultInfo(vault, container.isEncrypted, password))
    
  } catch (error) {
    console.error('Error: Failed to process vault file')
    console.error(`Details: ${(error as Error).message}`)
    console.error('')
    console.error('This could be due to:')
    console.error('  - Corrupted or invalid vault file')
    console.error('  - Incorrect password for encrypted vault')
    console.error('  - Unsupported vault format version')
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}
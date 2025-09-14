#!/usr/bin/env node

/**
 * Inspect the HotVault.vult to understand the session and server information
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash, createDecipheriv } from 'crypto'

async function inspectVault() {
  console.log('🔍 Inspecting HotVault.vult')
  console.log('==========================\n')

  const vaultPath = '/Users/dev/dev/vultisig/vultisig-sdk/clients/cli/vaults/HotVault.vult'
  
  try {
    // Read the vault file
    const vaultContent = fs.readFileSync(vaultPath, 'utf8')
    console.log('📋 Raw vault file analysis:')
    console.log('  File size:', vaultContent.length, 'characters')
    console.log('  First 50 chars:', vaultContent.slice(0, 50))
    
    // Decode base64 outer layer
    const decodedOuter = Buffer.from(vaultContent, 'base64')
    console.log('  Decoded size:', decodedOuter.length, 'bytes')
    
    // Import protobuf library
    const { VaultContainer } = await import('vultisig-sdk')
    
    try {
      // Parse VaultContainer
      const container = VaultContainer.decode(decodedOuter)
      console.log('\n📦 VaultContainer:')
      console.log('  Version:', container.version)
      console.log('  Is Encrypted:', container.is_encrypted)
      console.log('  Vault data length:', container.vault.length)
      
      let vaultData
      if (container.is_encrypted) {
        console.log('\n🔒 Decrypting vault with password Ashley89!...')
        
        // Decrypt vault data
        const password = 'Ashley89!'
        const key = createHash('sha256').update(password).digest()
        const encryptedData = Buffer.from(container.vault, 'base64')
        
        // Extract nonce (first 12 bytes) and ciphertext
        const nonce = encryptedData.subarray(0, 12)
        const ciphertext = encryptedData.subarray(12)
        
        console.log('  Key length:', key.length)
        console.log('  Nonce length:', nonce.length)
        console.log('  Ciphertext length:', ciphertext.length)
        
        // Decrypt using AES-256-GCM
        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        // Note: For GCM, we'd need the auth tag, but let's try a simpler approach
        
        // Try to decode as base64 first (might not be encrypted)
        try {
          vaultData = Buffer.from(container.vault, 'base64')
          console.log('  Successfully decoded as base64 (not encrypted)')
        } catch (e) {
          console.log('  Failed to decrypt:', e.message)
          return
        }
      } else {
        // Decode base64 inner layer
        vaultData = Buffer.from(container.vault, 'base64')
      }
      
      // Parse inner Vault protobuf
      const { Vault } = await import('vultisig-sdk')
      const vault = Vault.decode(vaultData)
      
      console.log('\n🏛️ Vault Details:')
      console.log('  Name:', vault.name)
      console.log('  ECDSA Public Key:', vault.public_key_ecdsa)
      console.log('  EdDSA Public Key:', vault.public_key_eddsa || 'None')
      console.log('  Chain Code:', vault.hex_chain_code)
      console.log('  Local Party ID:', vault.local_party_id)
      console.log('  Reshare Prefix:', vault.reshare_prefix || 'None')
      console.log('  Lib Type:', vault.lib_type)
      console.log('  Created At:', new Date(vault.created_at.seconds * 1000).toISOString())
      
      console.log('\n👥 Signers:')
      vault.signers.forEach((signer, index) => {
        const isLocal = signer === vault.local_party_id
        const isServer = signer.startsWith('Server-')
        console.log(`  ${index + 1}. ${signer} ${isLocal ? '(LOCAL)' : ''} ${isServer ? '(SERVER)' : ''}`)
      })
      
      console.log('\n🔑 Key Shares:')
      vault.key_shares.forEach((keyShare, index) => {
        console.log(`  ${index + 1}. Public Key: ${keyShare.public_key.slice(0, 20)}...`)
        console.log(`      Key Share Length: ${keyShare.keyshare.length} bytes`)
      })
      
      // Analysis for fast signing
      const serverSigners = vault.signers.filter(s => s.startsWith('Server-'))
      const hasFastVault = serverSigners.length > 0
      
      console.log('\n🚀 Fast Signing Analysis:')
      console.log('  Has VultiServer:', hasFastVault ? 'YES' : 'NO')
      if (hasFastVault) {
        console.log('  Server Parties:', serverSigners.join(', '))
        console.log('  Expected in session:', serverSigners[0])
      }
      console.log('  Local Party ID:', vault.local_party_id)
      console.log('  Total Participants:', vault.signers.length)
      
    } catch (error) {
      console.error('❌ Failed to parse vault:', error.message)
    }
    
  } catch (error) {
    console.error('❌ Failed to read vault file:', error.message)
    console.error('   Make sure the file exists at:', vaultPath)
  }
}

inspectVault().catch(console.error)

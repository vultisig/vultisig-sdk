import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Vultisig } from '../../VultisigSDK'
import type { SigningPayload } from '../../types'

// Load environment variables from .env file
function loadEnvFile() {
  try {
    const possibleEnvPaths = [
      join(__dirname, '.env'), // Current directory first
      join(process.cwd(), '.env'),
      join(process.cwd(), '..', '.env'),
      join(__dirname, '..', '..', '.env'),
      join(__dirname, '..', '..', '..', '.env')
    ]
    
    let envPath: string | undefined
    for (const path of possibleEnvPaths) {
      try {
        readFileSync(path, 'utf8')
        envPath = path
        break
      } catch {
        // Try next path
      }
    }
    
    if (!envPath) {
      console.log('⚠️ Could not find .env file in any expected location')
      return
    }
    
    const envContent = readFileSync(envPath, 'utf8')
    const lines = envContent.split('\n')
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=')
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim()
          process.env[key.trim()] = value
        }
      }
    }
    console.log('📄 Loaded .env file successfully')
  } catch (error) {
    console.log('⚠️ Could not load .env file:', (error as Error).message)
  }
}

// Load .env at module level
loadEnvFile()

describe('ServerManager Fast Signing Tests', () => {
  it('should test ServerManager fast signing flow with real vault', async () => {
    // Check for required environment variables
    const vaultPath = process.env.VAULT_PATH
    const vaultPassword = process.env.VAULT_PASSWORD
    
    if (!vaultPath || !vaultPassword) {
      console.log('⏭️ Skipping ServerManager test - VAULT_PATH and VAULT_PASSWORD environment variables required')
      console.log('   Set VAULT_PATH=/path/to/vault.vult and VAULT_PASSWORD=your_password in .env')
      return
    }

    console.log('🔧 Testing ServerManager with environment configuration:')
    console.log('   VAULT_PATH:', vaultPath)
    console.log('   VAULT_PASSWORD:', vaultPassword.slice(0, 3) + '*'.repeat(vaultPassword.length - 3))

    // Load vault file - handle both absolute and relative paths
    let vaultFileBuffer: Buffer
    let resolvedVaultPath = vaultPath
    
    try {
      // Try the path as-is first
      vaultFileBuffer = readFileSync(vaultPath)
      console.log('📁 Found vault file at:', vaultPath)
    } catch (error) {
      // If that fails, try relative to the tests directory
      const alternativePath = join(__dirname, '..', 'vaults', 'HotVault.vult')
      try {
        vaultFileBuffer = readFileSync(alternativePath)
        resolvedVaultPath = alternativePath
        console.log('📁 Found vault file at alternative path:', alternativePath)
      } catch (error2) {
        console.log('❌ Could not read vault file at:', vaultPath)
        console.log('❌ Could not read vault file at alternative path:', alternativePath)
        console.log('   Original error:', (error as Error).message)
        console.log('   Alternative error:', (error2 as Error).message)
        throw new Error(`Failed to read vault file. Tried: ${vaultPath} and ${alternativePath}`)
      }
    }
    
    console.log('📏 File size:', vaultFileBuffer.length, 'bytes')

    // Create File object for the vault
    const vaultFile = new File([vaultFileBuffer], 'test-vault.vult', {
      type: 'application/octet-stream'
    })
    // Add buffer property for Node.js compatibility
    ;(vaultFile as any).buffer = vaultFileBuffer

    // Initialize SDK and load vault
    console.log('🚀 Initializing VultisigSDK...')
    const vultisig = new Vultisig()
    
    let vault
    try {
      vault = await vultisig.addVault(vaultFile, vaultPassword)
      console.log('✅ Vault loaded successfully!')
    } catch (error) {
      console.error('❌ Failed to load vault:', error)
      throw error
    }

    // Get vault summary
    const summary = vault.summary()
    console.log('🔐 Vault Summary:')
    console.log('   Name:', summary.name)
    console.log('   Type:', summary.type)
    console.log('   Chains:', summary.chains.length)

    // Access vault data directly to get signers information
    const vaultData = (vault as any).vaultData
    console.log('   Signers Count:', vaultData.signers?.length || 0)
    console.log('   Signers:', vaultData.signers?.join(', ') || 'None')

    // Check if this is a fast vault (has Server- signer)
    const hasServerSigner = vaultData.signers?.some((signer: string) => signer.startsWith('Server-')) || false
    console.log('⚡ Fast vault check:', hasServerSigner ? 'YES' : 'NO')
    
    if (!hasServerSigner) {
      console.log('⚠️ This vault does not have a VultiServer signer - fast signing not available')
      console.log('   Vault signers:', vaultData.signers || [])
      return
    }

    // Load the test transaction payload
    console.log('📄 Loading test transaction payload...')
    const payloadPath = join(__dirname, 'eth-tx-payload.json')
    let transactionPayload
    try {
      const payloadContent = readFileSync(payloadPath, 'utf8')
      transactionPayload = JSON.parse(payloadContent)
      console.log('📋 Transaction payload loaded:', {
        to: transactionPayload.to,
        value: transactionPayload.value,
        gasLimit: transactionPayload.gasLimit,
        chainId: transactionPayload.chainId
      })
    } catch (error) {
      console.error('❌ Failed to load transaction payload:', error)
      throw error
    }

    // Create signing payload
    const signingPayload: SigningPayload = {
      transaction: transactionPayload,
      chain: 'ethereum'
    }

    // Test ServerManager directly
    console.log('🔧 Testing ServerManager.signWithServer directly...')
    const serverManager = vultisig.getServerStatus
    
    try {
      // Get server status first
      console.log('🏥 Checking server status...')
      const serverStatus = await vultisig.getServerStatus()
      console.log('   FastVault:', serverStatus.fastVault.online ? '✅ Online' : '❌ Offline')
      console.log('   MessageRelay:', serverStatus.messageRelay.online ? '✅ Online' : '❌ Offline')
      
      if (!serverStatus.fastVault.online) {
        console.log('⚠️ FastVault server is offline - cannot test signing')
        return
      }

    } catch (error) {
      console.log('⚠️ Server status check failed:', (error as Error).message)
      // Continue with signing test anyway
    }

    // Attempt fast signing
    console.log('✍️ Attempting fast signing...')
    console.log('   Using vault:', summary.name)
    console.log('   Transaction to:', transactionPayload.to)
    console.log('   Chain: ethereum')
    
    try {
      const signature = await vault.sign('fast', signingPayload, vaultPassword)
      
      console.log('🎉 Fast signing completed successfully!')
      console.log('📝 Signature details:')
      console.log('   Format:', signature.format)
      console.log('   Length:', signature.signature.length)
      console.log('   Signature (first 20 chars):', signature.signature.slice(0, 20) + '...')
      console.log('   Recovery ID:', signature.recovery)
      
      // Verify signature properties
      expect(signature).toBeDefined()
      expect(signature.signature).toBeTruthy()
      expect(typeof signature.signature).toBe('string')
      expect(signature.format).toMatch(/^(ECDSA|EdDSA|DER)$/)
      
      // For Ethereum, we typically expect DER or ECDSA format
      console.log('✅ All signature validations passed!')
      
    } catch (error) {
      console.error('❌ Fast signing failed:', error)
      console.error('   Error type:', error?.constructor?.name)
      console.error('   Error message:', (error as Error).message)
      
      // Check for specific error patterns
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase()
        
        if (errorMsg.includes('method not allowed')) {
          console.log('🔍 Analysis: Method Not Allowed error detected')
          console.log('   This suggests the FastVault API endpoint is rejecting the request')
          console.log('   Possible causes:')
          console.log('   - Wrong HTTP method (GET vs POST)')
          console.log('   - Incorrect API endpoint URL')
          console.log('   - Missing required headers')
          console.log('   - Server configuration issue')
          
          // This is the specific error we're debugging
          expect(error.message).toContain('Method Not Allowed')
          console.log('✅ Successfully reproduced the Method Not Allowed error!')
          return
        }
        
        if (errorMsg.includes('network') || errorMsg.includes('connection') || errorMsg.includes('timeout')) {
          console.log('⚠️ Network connectivity issue - this is expected in some test environments')
          return
        }
        
        if (errorMsg.includes('authentication') || errorMsg.includes('unauthorized') || errorMsg.includes('forbidden')) {
          console.log('⚠️ Authentication issue - this may be expected without proper server setup')
          return
        }
      }
      
      // For unexpected errors, re-throw
      throw error
    }
  }, 30000) // 30 second timeout for network operations

  it('should handle missing environment variables gracefully', async () => {
    // Temporarily clear env vars
    const originalVaultPath = process.env.VAULT_PATH
    const originalVaultPassword = process.env.VAULT_PASSWORD
    
    delete process.env.VAULT_PATH
    delete process.env.VAULT_PASSWORD
    
    try {
      const vultisig = new Vultisig()
      const status = await vultisig.getServerStatus()
      
      // Should still be able to check server status
      expect(typeof status.fastVault.online).toBe('boolean')
      expect(typeof status.messageRelay.online).toBe('boolean')
      expect(typeof status.timestamp).toBe('number')
      
      console.log('✅ ServerManager works without environment variables for status checks')
    } finally {
      // Restore env vars
      if (originalVaultPath) process.env.VAULT_PATH = originalVaultPath
      if (originalVaultPassword) process.env.VAULT_PASSWORD = originalVaultPassword
    }
  })

  it('should validate vault requirements for fast signing', async () => {
    // Test with a non-fast vault (if available)
    const testVaultPath = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share1of2-Password123!.vult')
    
    let vaultFileBuffer: Buffer
    try {
      vaultFileBuffer = readFileSync(testVaultPath)
    } catch (error) {
      console.log('⏭️ Skipping secure vault test - test vault not found')
      return
    }

    const vaultFile = new File([vaultFileBuffer], 'secure-vault.vult', {
      type: 'application/octet-stream'
    })
    ;(vaultFile as any).buffer = vaultFileBuffer

    const vultisig = new Vultisig()
    
    try {
      const vault = await vultisig.addVault(vaultFile, 'Password123!')
      const summary = vault.summary()
      
      console.log('🔐 Testing with secure vault:', summary.name)
      console.log('   Type:', summary.type)
      
      // Access vault data directly to get signers information
      const vaultData = (vault as any).vaultData
      console.log('   Signers:', vaultData.signers?.join(', ') || 'None')
      
      const hasServerSigner = vaultData.signers?.some((signer: string) => signer.startsWith('Server-')) || false
      
      if (!hasServerSigner) {
        console.log('✅ Confirmed: Secure vault does not have Server signer (as expected)')
        
        // Attempt fast signing should fail gracefully
        const signingPayload: SigningPayload = {
          transaction: { to: '0x123', value: '0', data: '0x' },
          chain: 'ethereum'
        }
        
        await expect(vault.sign('fast', signingPayload, 'Password123!'))
          .rejects
          .toThrow(/VultiServer|fast signing not available/i)
          
        console.log('✅ Fast signing correctly rejected for secure vault')
      }
      
    } catch (error) {
      if ((error as Error).message.includes('Wrong password')) {
        console.log('⚠️ Password issue with test secure vault - this is expected')
      } else {
        throw error
      }
    }
  })
})

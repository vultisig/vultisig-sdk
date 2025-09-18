#!/usr/bin/env node

/**
 * Manual Balance Test
 * Manually creates SDK and vault with proper initialization to test balance methods
 */

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

// File polyfill for Node.js
globalThis.File = function File(chunks, name, options) {
  this.chunks = chunks
  this.name = name
  this.options = options
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  this.buffer = buffer
  this._buffer = buffer
  this.arrayBuffer = function() {
    return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  }
}

// Setup fetch polyfill for WASM
globalThis.fetch = async function(url) {
  const urlString = url.toString()
  
  if (urlString.includes('.wasm')) {
    const projectRoot = path.resolve(__dirname, '../../../..')
    
    let wasmPath
    if (urlString.includes('wallet-core.wasm')) {
      wasmPath = path.join(projectRoot, 'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm')
    } else if (urlString.includes('vs_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/dkls/vs_wasm_bg.wasm')
    } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/schnorr/vs_schnorr_wasm_bg.wasm')
    }
    
    if (wasmPath && fs.existsSync(wasmPath)) {
      const wasmBuffer = fs.readFileSync(wasmPath)
      const arrayBuffer = wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength)
      
      return new Response(arrayBuffer, {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/wasm'
        })
      })
    }
    
    throw new Error(`WASM file not found: ${urlString}`)
  }
  
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found')
  })
}

async function testBalanceManually() {
  try {
    console.log('🧪 Manual Balance Test')
    console.log('═'.repeat(50))
    
    // Load the SDK
    const sdkPath = path.resolve(__dirname, '../../../../src/dist/index.js')
    console.log('📦 Loading SDK from:', sdkPath)
    
    if (!fs.existsSync(sdkPath)) {
      console.log('❌ SDK not found at:', sdkPath)
      throw new Error('SDK build not found. Please build the SDK first.')
    }
    
    // Import as ES module in CommonJS context
    const VultisigModule = await import(sdkPath)
    const VultisigSDK = VultisigModule.Vultisig
    console.log('✅ SDK loaded successfully')
    
    // Create SDK instance
    console.log('⚙️ Creating SDK instance...')
    const sdk = new VultisigSDK({
      defaultChains: ['bitcoin', 'ethereum', 'solana'],
      defaultCurrency: 'USD',
    })
    
    // Initialize SDK
    console.log('🔧 Initializing SDK...')
    await sdk.initialize()
    console.log('✅ SDK initialized')
    
    // Load vault
    const vaultPath = process.env.VAULT_PATH || 'vaults/HotVault.vult'
    const vaultPassword = process.env.VAULT_PASSWORD || ''
    
    console.log(`📂 Loading vault: ${vaultPath}`)
    const fullVaultPath = path.resolve(__dirname, '../../', vaultPath)
    const vaultBuffer = fs.readFileSync(fullVaultPath)
    const vaultFile = new File([vaultBuffer], path.basename(vaultPath))
    vaultFile.buffer = vaultBuffer
    
    console.log('🔐 Adding vault to SDK...')
    const vault = await sdk.addVault(vaultFile, vaultPassword)
    console.log('✅ Vault added successfully')
    
    // Check vault methods
    console.log('\n🔍 Checking vault methods:')
    console.log('  - balance:', typeof vault.balance)
    console.log('  - balances:', typeof vault.balances)
    console.log('  - address:', typeof vault.address)
    console.log('  - summary:', typeof vault.summary)
    
    // Test address derivation
    console.log('\n📍 Testing address derivation...')
    const ethAddress = await vault.address('ethereum')
    console.log(`✅ Ethereum address: ${ethAddress}`)
    
    // Test balance if method exists
    if (typeof vault.balance === 'function') {
      console.log('\n💰 Testing balance method...')
      try {
        const balance = await vault.balance('ethereum')
        console.log('✅ Balance result:', balance)
        
        const amount = parseFloat(balance.amount) / Math.pow(10, balance.decimals)
        console.log(`💰 Formatted: ${amount} ${balance.symbol}`)
      } catch (error) {
        console.log('❌ Balance method error:', error.message)
      }
    } else {
      console.log('❌ balance method not available')
    }
    
    // Test balances if method exists
    if (typeof vault.balances === 'function') {
      console.log('\n💰 Testing balances method...')
      try {
        const balances = await vault.balances(['ethereum'])
        console.log('✅ Balances result:', balances)
      } catch (error) {
        console.log('❌ Balances method error:', error.message)
      }
    } else {
      console.log('❌ balances method not available')
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

testBalanceManually()

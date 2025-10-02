#!/usr/bin/env node

/**
 * Simple Balance Test
 * Tests the balance command using the built CLI binary and .env configuration
 * This bypasses SDK build issues by using the working CLI binary
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const https = require('https')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

async function testEthereumRPCDirect() {
  console.log('🌐 Testing Ethereum RPC endpoint directly...')
  
  const address = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
  const rpcUrl = 'https://api.vultisig.com/eth/'
  
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_getBalance',
    params: [address, 'latest'],
    id: 1
  })

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  }

  return new Promise((resolve, reject) => {
    const req = https.request(rpcUrl, options, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          
          if (response.result) {
            const hexBalance = response.result
            const weiBalance = BigInt(hexBalance)
            const ethBalance = Number(weiBalance) / 1e18
            
            console.log(`✅ RPC works: ${ethBalance} ETH at ${address}`)
            resolve({ hexBalance, weiBalance: weiBalance.toString(), ethBalance })
          } else {
            reject(new Error(`RPC Error: ${response.error?.message || 'Unknown error'}`))
          }
        } catch (error) {
          reject(error)
        }
      })
    })
    
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function testVaultAddress() {
  console.log('\n📍 Testing vault address derivation...')
  
  return new Promise((resolve, reject) => {
    const vaultName = process.env.VAULT_NAME || 'vaults/HotVault.vult'
    const vaultPassword = process.env.VAULT_PASSWORD || ''
    
    const args = ['address', '--vault', vaultName, '--network', 'ethereum']
    if (vaultPassword) {
      args.push('--password', vaultPassword)
    }
    
    const vultisigPath = path.resolve(__dirname, '../../bin/vultisig')
    const child = spawn('node', [vultisigPath, ...args], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe'
    })
    
    let output = ''
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    child.stderr.on('data', (data) => {
      output += data.toString()
    })
    
    child.on('close', (code) => {
      if (code === 0) {
        // Extract address from output
        const addressMatch = output.match(/0x[a-fA-F0-9]{40}/)
        if (addressMatch) {
          console.log(`✅ Address derived: ${addressMatch[0]}`)
          resolve(addressMatch[0])
        } else {
          reject(new Error('Could not extract address from output'))
        }
      } else {
        reject(new Error(`Address command failed with code ${code}: ${output}`))
      }
    })
  })
}

async function testBalanceCommand() {
  console.log('\n💰 Testing balance command...')
  
  return new Promise((resolve, reject) => {
    const vaultName = process.env.VAULT_NAME || 'vaults/HotVault.vult'
    const vaultPassword = process.env.VAULT_PASSWORD || ''
    
    const args = ['balance', '--vault', vaultName, '--network', 'ethereum']
    if (vaultPassword) {
      args.push('--password', vaultPassword)
    }
    
    const vultisigPath = path.resolve(__dirname, '../../bin/vultisig')
    const child = spawn('node', [vultisigPath, ...args], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe'
    })
    
    let output = ''
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    child.stderr.on('data', (data) => {
      output += data.toString()
    })
    
    child.on('close', (code) => {
      console.log('📋 Balance command output:')
      console.log(output)
      resolve({ code, output })
    })
  })
}

async function runDiagnosticTests() {
  console.log('🔬 Vultisig Balance Diagnostic Tests')
  console.log('═'.repeat(50))
  
  try {
    // Test 1: RPC endpoint directly
    console.log('🧪 Test 1: Direct RPC endpoint')
    await testEthereumRPCDirect()
    
    // Test 2: Vault address derivation  
    console.log('\n🧪 Test 2: Vault address derivation')
    const derivedAddress = await testVaultAddress()
    
    // Test 3: Balance command
    console.log('\n🧪 Test 3: Balance command')
    const balanceResult = await testBalanceCommand()
    
    // Analysis
    console.log('\n📊 Diagnostic Results')
    console.log('═'.repeat(50))
    console.log('✅ RPC endpoint: Working')
    console.log('✅ Address derivation: Working')
    console.log(`${balanceResult.code === 0 ? '✅' : '❌'} Balance command: ${balanceResult.code === 0 ? 'Working' : 'Failed'}`)
    
    if (balanceResult.output.includes('vault.balance is not a function')) {
      console.log('\n🔍 Root Cause Analysis:')
      console.log('❌ Vault object missing balance methods')
      console.log('💡 Likely cause: WASMManager not properly initialized in vault constructor')
      console.log('🔧 Fix needed: Ensure VaultManagement passes wasmManager to Vault constructor')
    }
    
    if (balanceResult.output.includes('ChainManager not available')) {
      console.log('\n🔍 Root Cause Analysis:')
      console.log('❌ ChainManager not initialized')
      console.log('💡 Likely cause: WASMManager missing from vault')
      console.log('🔧 Fix needed: Proper WASMManager initialization')
    }
    
  } catch (error) {
    console.error('💥 Diagnostic test failed:', error.message)
    process.exit(1)
  }
}

runDiagnosticTests()

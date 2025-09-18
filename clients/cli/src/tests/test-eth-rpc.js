#!/usr/bin/env node

/**
 * Test Ethereum RPC endpoint directly
 * This script tests the Vultisig Ethereum RPC and manually formats balance
 */

const https = require('https')

async function testEthereumRPC() {
  const address = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
  const rpcUrl = 'https://api.vultisig.com/eth/'
  
  console.log('🧪 Testing Ethereum RPC Endpoint')
  console.log('═'.repeat(50))
  console.log(`📍 Address: ${address}`)
  console.log(`🌐 RPC URL: ${rpcUrl}`)
  console.log('')

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
          console.log('📡 RPC Response:')
          console.log(JSON.stringify(response, null, 2))
          
          if (response.result) {
            const hexBalance = response.result
            const weiBalance = BigInt(hexBalance)
            const ethBalance = Number(weiBalance) / 1e18
            
            console.log('')
            console.log('💰 Balance Details:')
            console.log(`   Hex: ${hexBalance}`)
            console.log(`   Wei: ${weiBalance.toString()}`)
            console.log(`   ETH: ${ethBalance}`)
            console.log('')
            console.log('✅ RPC endpoint is working correctly!')
            
            // Format like the CLI would
            const formattedBalance = {
              amount: weiBalance.toString(),
              decimals: 18,
              symbol: 'ETH'
            }
            
            console.log('🎯 Formatted for CLI:')
            console.log(JSON.stringify(formattedBalance, null, 2))
            
            resolve(formattedBalance)
          } else if (response.error) {
            console.log('❌ RPC Error:', response.error)
            reject(new Error(`RPC Error: ${response.error.message}`))
          } else {
            console.log('❓ Unexpected response format')
            reject(new Error('Unexpected response format'))
          }
        } catch (error) {
          console.log('❌ Failed to parse response:', error.message)
          console.log('Raw response:', data)
          reject(error)
        }
      })
    })
    
    req.on('error', (error) => {
      console.log('❌ Request failed:', error.message)
      reject(error)
    })
    
    req.write(payload)
    req.end()
  })
}

// Test the RPC endpoint
testEthereumRPC()
  .then(() => {
    console.log('🎉 Test completed successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Test failed:', error.message)
    process.exit(1)
  })

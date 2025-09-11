#!/usr/bin/env node

/**
 * Test using master vault key as coin's hex_public_key like the test fixture
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

async function testMasterKeyApproach() {
  console.log('🧪 Testing Master Key Approach')
  console.log('==============================\n')
  
  try {
    // Import the core system functions
    const { getPreSigningHashes } = await import('@core/chain/tx/preSigningHashes')
    const { getEvmTxInputData } = await import('@core/mpc/keysign/txInputData/resolvers/evm')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import('@core/mpc/types/vultisig/keysign/v1/keysign_message_pb')
    const { CoinSchema } = await import('@core/mpc/types/vultisig/keysign/v1/coin_pb')
    
    const walletCore = await initWasm()
    
    // Our vault information
    const masterEcdsaKey = '027b25c8ea94b53daa502be1f112201bcc29eb197d28eba6af2344c023ae3aeea4'
    const expectedAddress = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
    
    // Transaction parameters
    const tx = {
      to: expectedAddress,
      value: '100000000000000',
      gas: '21000',
      maxFeePerGas: '20000000000',
      maxPriorityFeePerGas: '2000000000',
      data: '0x',
      nonce: 122,
      chainId: 1,
      type: 2
    }
    
    console.log('🔑 Testing with master vault key as coin hex_public_key:')
    console.log('  Master ECDSA Key:', masterEcdsaKey)
    console.log('  Expected Address:', expectedAddress)
    
    // Create coin object using MASTER VAULT KEY as hex_public_key (like the test fixture)
    const coin = create(CoinSchema, {
      chain: 'Ethereum',
      ticker: 'ETH',
      address: expectedAddress, // Use expected address
      decimals: 18,
      hexPublicKey: masterEcdsaKey, // ← Use MASTER key, not chain-specific
      isNativeToken: true,
      logo: '',
      priceProviderId: '',
      contractAddress: '',
    })
    
    console.log('🔍 Created coin with master key as hex_public_key')
    
    // Create KeysignPayload
    const keysignPayload = create(KeysignPayloadSchema, {
      coin,
      toAddress: tx.to,
      toAmount: tx.value,
      memo: tx.data,
      vaultPublicKeyEcdsa: masterEcdsaKey, // Also use master key here
      vaultLocalPartyId: 'CLI',
      blockchainSpecific: {
        case: 'ethereumSpecific',
        value: {
          maxFeePerGasWei: tx.maxFeePerGas,
          priorityFee: tx.maxPriorityFeePerGas,
          nonce: BigInt(tx.nonce),
          gasLimit: BigInt(tx.gas),
        }
      }
    })
    
    console.log('🔍 KeysignPayload using master key:')
    console.log('  Coin hex_public_key:', keysignPayload.coin.hexPublicKey)
    console.log('  Vault public key:', keysignPayload.vaultPublicKeyEcdsa)
    console.log('  Are they same?:', keysignPayload.coin.hexPublicKey === keysignPayload.vaultPublicKeyEcdsa ? '✅ YES' : '❌ NO')
    
    // Generate transaction input data
    const txInputDataArray = getEvmTxInputData({
      keysignPayload,
      walletCore,
      chain: 'Ethereum',
    })
    
    console.log('🔍 Transaction input data:')
    console.log('  Count:', txInputDataArray.length)
    console.log('  Length:', txInputDataArray[0]?.length)
    
    // Get message hashes
    const messageHashes = []
    for (const txInputData of txInputDataArray) {
      const hashes = getPreSigningHashes({
        walletCore,
        txInputData,
        chain: 'Ethereum',
      })
      
      hashes.forEach(hash => {
        const hexHash = Buffer.from(hash).toString('hex')
        messageHashes.push(hexHash)
      })
    }
    
    console.log('🔍 Generated message hashes:', messageHashes)
    
    // Compare with our previous message hash
    const previousHash = 'e5cb0f65221a2e84d3c1700cfe0d98b788ada4170ff72e68754febf99bb1f467'
    console.log('🔍 Comparison with previous:')
    console.log('  Previous hash:', previousHash)
    console.log('  New hash:     ', messageHashes[0])
    console.log('  Same hash?:', messageHashes[0] === previousHash ? '✅ YES' : '❌ NO')
    
    // Test signature recovery with this approach
    const unsigned = viemSerialize({
      type: 'eip1559',
      chainId: tx.chainId,
      nonce: tx.nonce,
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data,
      gas: BigInt(tx.gas),
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
      accessList: [],
    })
    
    const digest = keccak256(getBytes(unsigned))
    console.log('\n🔍 Transaction verification:')
    console.log('  Unsigned RLP:', unsigned)
    console.log('  Digest:', digest)
    console.log('  Matches message hash:', digest === '0x' + messageHashes[0] ? '✅ YES' : '❌ NO')
    
    console.log('\n💡 Key insight:')
    console.log('The test fixture uses the SAME key for both coin.hex_public_key and vault_public_key_ecdsa')
    console.log('This might be the correct approach for fast vaults')
    
  } catch (error) {
    console.log('❌ Test failed:', error.message)
    console.log(error)
  }
}

testMasterKeyApproach().catch(console.error)

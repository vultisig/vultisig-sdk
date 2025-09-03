import { VaultLoader } from '../src/vault/VaultLoader'
import * as path from 'path'

async function testVaultLoader() {
  const loader = new VaultLoader()
  
  // Test files in keyshares directory
  const keyshareDir = path.join(__dirname, 'keyshares')
  const testFiles = [
    'TestFastVault-44fd-share1of2-Vultiserver.vult',
    'TestSecureVault-cfa0-share2of2-Nopassword.vult'
  ]
  
  console.log('🔍 Testing VaultLoader Implementation\n')
  
  for (const filename of testFiles) {
    const filePath = path.join(keyshareDir, filename)
    
    console.log(`📁 Testing: ${filename}`)
    
    try {
      // Check if file exists
      if (!(await loader.exists(filePath))) {
        console.log('  ❌ File not found')
        continue
      }
      
      // Check encryption status
      const isUnencrypted = await loader.checkIfUnencrypted(filePath)
      console.log(`  🔒 Encrypted: ${!isUnencrypted}`)
      
      // Get basic info
      const info = await loader.getVaultInfo(filePath)
      console.log(`  📋 Name: ${info.name}`)
      console.log(`  👥 Signers: ${info.signers.join(', ')}`)
      
      // Try to load vault (without password for encrypted ones)
      if (!info.isEncrypted) {
        const vault = await loader.loadVaultFromFile(filePath)
        console.log(`  ✅ Loaded successfully`)
        console.log(`  🔑 ECDSA Key: ${vault.publicKeyEcdsa.substring(0, 20)}...`)
        console.log(`  🔑 EdDSA Key: ${vault.publicKeyEddsa.substring(0, 20)}...`)
        console.log(`  🔗 Chain Code: ${vault.hexChainCode.substring(0, 20)}...`)
        console.log(`  📊 KeyShares: ${vault.keyShares.length}`)
      } else {
        console.log(`  ⚠️  Skipping load (encrypted, no password)`)
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : error}`)
    }
    
    console.log('')
  }
}

testVaultLoader().catch(console.error)
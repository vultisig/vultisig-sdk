import { Chain } from '@vultisig/core'

import { loadTestVault } from './tests/helpers/test-vault'

async function debugGasEstimation() {
  console.log('🔍 Loading test vault...')
  const { vault } = await loadTestVault()

  console.log('✅ Vault loaded')
  console.log('📍 Ethereum address:', vault.getAddress(Chain.Ethereum))

  try {
    console.log('\n⛽ Attempting Ethereum gas estimation...')
    const gasInfo = await vault.gas(Chain.Ethereum)
    console.log('✅ Gas estimation succeeded!')
    console.log('Gas info:', gasInfo)
  } catch (error) {
    console.error('\n❌ Gas estimation failed!')
    console.error('Error type:', error?.constructor?.name)
    console.error('Error message:', (error as Error)?.message)
    console.error('Error stack:', (error as Error)?.stack)
    console.error('Full error object:', error)

    // Check if it's a VaultError with a cause
    if (error && typeof error === 'object' && 'cause' in error) {
      console.error('\n🔍 Error cause:', (error as any).cause)
      console.error('Cause message:', ((error as any).cause as Error)?.message)
      console.error('Cause stack:', ((error as any).cause as Error)?.stack)
    }
  }
}

debugGasEstimation().catch(console.error)

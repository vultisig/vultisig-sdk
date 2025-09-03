import { parseNetworksString, CHAIN_NAMES } from '../address/AddressDeriver'
import { DaemonManager } from '../daemon/DaemonManager'

export interface AddressOptions {
  network?: string
}

export class AddressCommand {
  readonly description = 'Show wallet addresses for supported networks (queries running daemon)'
  
  async run(options: AddressOptions): Promise<void> {
    // Parse requested networks
    const networks = options.network || 'all'
    const requestedChains = parseNetworksString(networks)
    
    // If specific networks requested, validate them
    if (networks !== 'all') {
      const invalidChains = networks.split(',')
        .map(n => n.trim().toLowerCase())
        .filter(n => !Object.keys(CHAIN_NAMES).includes(n))
      
      if (invalidChains.length > 0) {
        console.log(`⚠️  Warning: Unknown networks: ${invalidChains.join(', ')}`)
      }
    }
    
    // Query daemon for addresses
    console.log('🔍 Querying daemon for addresses...')
    const daemonManager = new DaemonManager()
    
    try {
      const addresses = await daemonManager.getAddresses(requestedChains)
      
      console.log('\n=== Addresses ===')
      for (const [chainKey, address] of Object.entries(addresses)) {
        const chainName = CHAIN_NAMES[chainKey] || chainKey
        if (address.startsWith('Error:')) {
          console.log(`  ❌ ${chainName}: ${address}`)
        } else {
          console.log(`  ✅ ${chainName}: ${address}`)
        }
      }
      
      console.log('\n💡 Addresses retrieved from running daemon')
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('No Vultisig daemon running')) {
        console.error('❌ No Vultisig daemon running, start with "vultisig run" first')
        process.exit(1)
      } else {
        console.error('❌ Error querying daemon:', error instanceof Error ? error.message : error)
        throw error
      }
    }
  }
}
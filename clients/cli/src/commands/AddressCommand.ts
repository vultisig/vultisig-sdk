import { VaultManager } from '../vultisig-sdk-mocked'
import { DaemonManager } from '../daemon/DaemonManager'

export interface AddressOptions {
  network?: string
}

export class AddressCommand {
  readonly description = 'Show wallet addresses for supported networks'
  
  async run(options: AddressOptions): Promise<void> {
    console.log('🔍 Querying addresses...')
    
    // Parse requested networks
    const networks = options.network || 'all'
    const requestedChains = this.parseNetworks(networks)
    
    // Try to get addresses from running daemon first
    try {
      const daemonManager = new DaemonManager()
      const addresses = await daemonManager.getAddresses(requestedChains)
      
      console.log('\n=== Addresses (from daemon) ===')
      for (const [chainKey, address] of Object.entries(addresses)) {
        const chainName = this.getChainName(chainKey)
        if (address.startsWith('Error:')) {
          console.log(`  ❌ ${chainName}: ${address}`)
        } else {
          console.log(`  ✅ ${chainName}: ${address}`)
        }
      }
      
      console.log('\n💡 Addresses retrieved from running daemon')
      return
      
    } catch (error) {
      // Daemon not running, try to use active vault directly
    }
    
    // Try to use active vault from SDK
    const activeVault = VaultManager.getActive()
    if (activeVault) {
      console.log('\n=== Addresses (from active vault) ===')
      
      const chains = requestedChains
      for (const chain of chains) {
        try {
          const address = await activeVault.address(chain)
          const chainName = this.getChainName(chain)
          console.log(`  ✅ ${chainName}: ${address}`)
        } catch (error) {
          const chainName = this.getChainName(chain)
          console.log(`  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
      
      console.log('\n💡 Addresses retrieved from active vault')
      return
    }
    
    // No daemon and no active vault
    console.error('❌ No active vault found and no daemon running.')
    console.error('   Start daemon with "vultisig run" first, or load a vault.')
    process.exit(1)
  }
  
  private parseNetworks(networks: string): string[] {
    if (networks === 'all') {
      return ['bitcoin', 'ethereum', 'solana', 'litecoin', 'dogecoin']
    }
    
    return networks.split(',').map(n => n.trim().toLowerCase())
  }
  
  private getChainName(chain: string): string {
    const names: Record<string, string> = {
      'bitcoin': 'Bitcoin',
      'ethereum': 'Ethereum', 
      'solana': 'Solana',
      'litecoin': 'Litecoin',
      'dogecoin': 'Dogecoin'
    }
    return names[chain.toLowerCase()] || chain
  }
}
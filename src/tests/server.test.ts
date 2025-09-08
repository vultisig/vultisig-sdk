import { describe, expect, it } from 'vitest'
import { Vultisig } from '../VultisigSDK'

describe('Server Status', () => {
  it('should check server status', async () => {
    const vultisig = new Vultisig()
    const status = await vultisig.getServerStatus()
    
    console.log(`FastVault: ${status.fastVault.online ? 'Online' : 'Offline'}`)
    console.log(`MessageRelay: ${status.messageRelay.online ? 'Online' : 'Offline'}`)
    
    expect(typeof status.fastVault.online).toBe('boolean')
    expect(typeof status.messageRelay.online).toBe('boolean')
    expect(status.timestamp).toBeTypeOf('number')
  })
})

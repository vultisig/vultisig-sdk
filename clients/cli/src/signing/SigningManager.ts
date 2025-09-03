import * as crypto from 'crypto'
import { VaultData } from '../vault/VaultLoader'
import { MpcMediatorServer } from '../mpc/MpcMediatorServer'

export interface SigningRequest {
  // Network and signature parameters
  scheme: 'ecdsa' | 'eddsa'
  curve: 'secp256k1' | 'ed25519'
  network: string
  messageType: string
  
  // Transaction payload (network-specific)
  payload: any
  
  // MPC session parameters
  sessionId?: string
  serverUrl?: string
  hexEncryptionKey?: string
  peers?: string[]
}

export interface SigningResult {
  signature: string
  txId?: string
  raw?: string
  signedPsbtBase64?: string
  finalTxHex?: string
}

export class SigningManager {
  private vault: VaultData
  private mpcMediatorServer?: MpcMediatorServer
  
  constructor(vault: VaultData) {
    this.vault = vault
  }
  
  async signTransaction(request: SigningRequest): Promise<SigningResult> {
    console.log(`🔐 Starting MPC signing for ${request.network} (${request.scheme})`)
    
    try {
      // Initialize MPC mediator server if not already running
      if (!this.mpcMediatorServer) {
        this.mpcMediatorServer = new MpcMediatorServer(this.vault)
        await this.mpcMediatorServer.start()
        
        // Advertise via mDNS for local discovery
        const deviceName = `vultisig-cli-${this.vault.localPartyId || 'device'}`
        await this.mpcMediatorServer.advertiseViaMdns(deviceName)
      }
      
      // Use the MPC mediator server to handle the signing
      const result = await this.mpcMediatorServer.signTransaction(request)
      
      console.log('✅ MPC signing completed successfully!')
      console.log(`   Signature: ${result.signature}`)
      
      return result
      
    } catch (error) {
      console.error('❌ Signing failed:', error instanceof Error ? error.message : error)
      throw error
    }
  }
  
  async cleanup(): Promise<void> {
    if (this.mpcMediatorServer) {
      await this.mpcMediatorServer.stop()
      this.mpcMediatorServer = undefined
    }
  }
}
import * as crypto from 'crypto'
import * as https from 'https'
import * as http from 'http'
import { VaultLoader } from '../vault/VaultLoader'

export interface FastMpcSigningInput {
  network: string
  payload: any
  password: string
  sessionId: string
  messageType: string
  scheme: 'ecdsa' | 'eddsa'
  vaultPath?: string
}

export interface FastMpcSigningResult {
  signature: string
  signedPsbtBase64?: string
  finalTxHex?: string
  raw?: string
}

export class VultiServerClient {
  private readonly baseUrl: string = 'https://api.vultisig.com/vault/router'

  /**
   * Check if vault exists on VultiServer by attempting to get vault info
   * Uses the vault/get/{vaultId} endpoint with password in x-password header
   */
  async checkVaultExists(password: string, vaultId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/get/${vaultId}`
      const response = await this.makeRequest(url, {
        method: 'GET',
        headers: {
          'x-password': this.base64Encode(password),
          'Content-Type': 'application/json'
        }
      })
      
      return response.status === 200
    } catch (error) {
      // If we get a 404 or other error, vault doesn't exist on server
      return false
    }
  }

  /**
   * Perform MPC signing ceremony with VultiServer
   * This requires local vault participation + server participation
   */
  async performMpcSigning(input: FastMpcSigningInput): Promise<FastMpcSigningResult> {
    // Load local vault for MPC participation
    const vaultLoader = new VaultLoader()
    const vault = await this.loadLocalVault(input.vaultPath)
    
    if (!vault) {
      throw new Error('Local vault not found. Fast mode requires local vault for MPC participation.')
    }

    // Get vault ID from local vault public key
    const vaultId = vault.publicKeyEcdsa || vault.publicKeyEddsa
    
    // Check if vault exists on server
    const vaultExists = await this.checkVaultExists(input.password, vaultId)
    if (!vaultExists) {
      throw new Error('Vault not found on VultiServer. Fast mode requires vault to be stored on VultiServer.')
    }

    // Extract messages to sign from payload
    const messages = this.extractMessagesFromPayload(input.payload, input.network)
    
    // This is where we would implement the full MPC ceremony
    // For now, throw an error indicating this needs proper MPC implementation
    throw new Error('Full MPC ceremony implementation needed - this requires WASM libraries and proper MPC protocol implementation')
    
    // TODO: Implement proper MPC ceremony:
    // 1. Initialize WASM libraries (DKLS for ECDSA, Schnorr for EdDSA)
    // 2. Setup MPC session with VultiServer as peer
    // 3. Exchange MPC messages through VultiServer API
    // 4. Complete signing ceremony and return signatures
  }

  /**
   * Load local vault for MPC participation
   */
  private async loadLocalVault(vaultPath?: string): Promise<any> {
    const vaultLoader = new VaultLoader()
    
    if (vaultPath) {
      // Load specific vault file
      return await vaultLoader.loadVault(vaultPath)
    } else {
      // Auto-discover vault file
      const vaultFiles = await vaultLoader.findVaultFiles()
      if (vaultFiles.length === 0) {
        return null
      }
      // Load first available vault
      return await vaultLoader.loadVault(vaultFiles[0].path)
    }
  }

  /**
   * Get public key for the vault (simplified approach)
   */
  private async getPublicKey(vaultId: string, password: string, scheme: 'ecdsa' | 'eddsa'): Promise<string> {
    // This is a placeholder implementation
    // In the real implementation, we'd need to:
    // 1. Load the local vault to get the appropriate public key
    // 2. Return the ECDSA or EdDSA public key based on the scheme
    // For now, we'll return a placeholder
    return scheme === 'ecdsa' ? 'placeholder-ecdsa-pubkey' : 'placeholder-eddsa-pubkey'
  }

  /**
   * Extract messages to sign from payload based on network
   */
  private extractMessagesFromPayload(payload: any, network: string): string[] {
    // This is a simplified implementation
    // In practice, this would need to handle different payload formats per network
    if (payload.raw) {
      return [payload.raw]
    }
    
    if (payload.message) {
      return [payload.message]
    }
    
    if (payload.messages && Array.isArray(payload.messages)) {
      return payload.messages
    }
    
    // For complex payloads, we'd need to process them based on network type
    // This is a placeholder that converts the payload to hex
    const payloadStr = JSON.stringify(payload)
    const payloadHex = Buffer.from(payloadStr).toString('hex')
    return [payloadHex]
  }

  /**
   * Get derivation path for network
   */
  private getDerivationPath(network: string): string {
    const networkLower = network.toLowerCase()
    
    // Standard BIP44 derivation paths for different networks
    const derivationPaths: Record<string, string> = {
      'btc': "m/84'/0'/0'/0/0",
      'eth': "m/44'/60'/0'/0/0",
      'matic': "m/44'/60'/0'/0/0",
      'bsc': "m/44'/60'/0'/0/0",
      'avax': "m/44'/60'/0'/0/0",
      'opt': "m/44'/60'/0'/0/0",
      'arb': "m/44'/60'/0'/0/0",
      'base': "m/44'/60'/0'/0/0",
      'sol': "m/44'/501'/0'/0'",
      'ada': "m/1852'/1815'/0'/0/0",
      'dot': "m/44'/354'/0'/0/0",
      'atom': "m/44'/118'/0'/0/0",
      'thor': "m/44'/931'/0'/0/0",
      'maya': "m/44'/931'/0'/0/0",
      'ltc': "m/84'/2'/0'/0/0",
      'doge': "m/44'/3'/0'/0/0",
      'xrp': "m/44'/144'/0'/0/0",
      'trx': "m/44'/195'/0'/0/0",
      'sui': "m/44'/784'/0'/0/0",
      'ton': "m/44'/607'/0'/0/0"
    }
    
    return derivationPaths[networkLower] || "m/44'/60'/0'/0/0"
  }

  /**
   * Base64 encode a string
   */
  private base64Encode(str: string): string {
    return Buffer.from(str).toString('base64')
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(url: string, options: {
    method: string
    headers: Record<string, string>
    body?: string
  }): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const isHttps = urlObj.protocol === 'https:'
      const client = isHttps ? https : http
      
      const req = client.request(url, {
        method: options.method,
        headers: options.headers
      }, (res) => {
        let data = ''
        
        res.on('data', (chunk) => {
          data += chunk
        })
        
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            json: async () => JSON.parse(data),
            text: async () => data
          })
        })
      })
      
      req.on('error', (error) => {
        reject(error)
      })
      
      if (options.body) {
        req.write(options.body)
      }
      
      req.end()
    })
  }
}

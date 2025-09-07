import axios, { type AxiosInstance } from 'axios'
import { base64Encode } from '@lib/utils/base64Encode'
import { fromMpcServerMessage } from '@core/mpc/message/server'
import type { 
  Vault, 
  SigningPayload, 
  Signature, 
  ReshareOptions 
} from '../types'

/**
 * FastVaultClient handles VultiServer Fast Vault API operations
 * Matches existing API patterns from core/mpc/fast/api
 */
export class FastVaultClient {
  private client: AxiosInstance

  constructor(baseURL: string = 'https://api.vultisig.com/vault') {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      },
      // Ensure HTTPS only for browser security
      httpsAgent: process.env.NODE_ENV === 'development' ? undefined : { rejectUnauthorized: true }
    })
  }

  /**
   * Create vault on server - POST /create
   */
  async createVault(params: {
    name: string
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    encryptionPassword: string
    email: string
    libType: number // 1=DKLS (always use DKLS)
  }): Promise<void> {
    const payload = {
      name: params.name,
      session_id: params.sessionId,
      hex_encryption_key: params.hexEncryptionKey,
      hex_chain_code: params.hexChainCode,
      local_party_id: params.localPartyId,
      encryption_password: params.encryptionPassword,
      email: params.email,
      lib_type: params.libType
    }
    
    console.log('FastVault API payload:', JSON.stringify(payload, null, 2))
    
    try {
      await this.client.post('/create', payload)
    } catch (error: any) {
      console.error('FastVault API error:', error.response?.data || error.message)
      throw error
    }
  }

  /**
   * Get vault from server using password - GET /get/{vaultId}
   */
  async getVault(vaultId: string, password: string): Promise<any> {
    const response = await this.client.get(`/get/${vaultId}`, {
      headers: {
        'x-password': base64Encode(password)
      }
    })

    return response.data
  }

  /**
   * Migrate existing vault to server - POST /migrate
   */
  async migrateVault(params: {
    publicKey: string
    sessionId: string
    hexEncryptionKey: string
    encryptionPassword: string
    email: string
  }): Promise<void> {
    await this.client.post('/migrate', {
      public_key: params.publicKey,
      session_id: params.sessionId,
      hex_encryption_key: params.hexEncryptionKey,
      encryption_password: params.encryptionPassword,
      email: params.email
    })
  }

  /**
   * Reshare vault participants - POST /reshare
   */
  async reshareVault(params: {
    name: string
    sessionId: string
    publicKey?: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    oldParties: string[]
    oldResharePrefix: string
    encryptionPassword: string
    email?: string
    reshareType?: number
    libType?: number
  }): Promise<void> {
    await this.client.post('/reshare', {
      name: params.name,
      session_id: params.sessionId,
      public_key: params.publicKey,
      hex_encryption_key: params.hexEncryptionKey,
      hex_chain_code: params.hexChainCode,
      local_party_id: params.localPartyId,
      old_parties: params.oldParties,
      old_reshare_prefix: params.oldResharePrefix,
      encryption_password: params.encryptionPassword,
      email: params.email,
      reshare_type: params.reshareType,
      lib_type: params.libType
    })
  }

  /**
   * Server-assisted signing - POST /sign
   */
  async signWithServer(params: {
    publicKey: string
    messages: string[] // hex-encoded message hashes
    session: string
    hexEncryptionKey: string
    derivePath: string
    isEcdsa: boolean
    vaultPassword: string
  }): Promise<void> {
    await this.client.post('/sign', {
      public_key: params.publicKey,
      messages: params.messages,
      session: params.session,
      hex_encryption_key: params.hexEncryptionKey,
      derive_path: params.derivePath,
      is_ecdsa: params.isEcdsa,
      vault_password: params.vaultPassword
    })
  }

  /**
   * Verify vault with email verification code - GET /verify/{vaultId}/{code}
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    try {
      console.log('🔐 FastVaultClient.verifyVault called:', { vaultId, code })
      const url = `/verify/${vaultId}/${code}`
      console.log('📤 Making verification request to:', url)
      
      const response = await this.client.get(url)
      
      console.log('📥 Verification response:', {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      })
      
      const success = response.status === 200
      console.log('✅ Verification result:', success)
      return success
    } catch (error: any) {
      console.error('❌ Verification request failed:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      })
      return false
    }
  }

  /**
   * Resend vault verification email (custom endpoint)
   */
  async resendVaultVerification(vaultId: string): Promise<void> {
    try {
      console.log('🔄 FastVaultClient.resendVaultVerification called:', { vaultId })
      const url = `/resend-verification/${vaultId}`
      console.log('📤 Making resend request to:', url)
      
      const response = await this.client.post(url)
      
      console.log('📥 Resend response:', {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      })
    } catch (error: any) {
      console.error('❌ Resend verification request failed:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      })
      throw error
    }
  }

  /**
   * Ping server for health check
   */
  async ping(): Promise<number> {
    const start = Date.now()
    // Use relay server ping endpoint
    await axios.get('https://api.vultisig.com/router/ping', { timeout: 10000 })
    return Date.now() - start
  }

  /**
   * Decrypt server message using hex encryption key
   */
  decryptServerMessage(encryptedBody: string, hexEncryptionKey: string): Buffer {
    return fromMpcServerMessage(encryptedBody, hexEncryptionKey)
  }
}
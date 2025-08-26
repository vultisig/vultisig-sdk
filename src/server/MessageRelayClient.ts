import axios, { type AxiosInstance } from 'axios'
import { toMpcServerMessage, fromMpcServerMessage } from '@core/mpc/message/server'
import { assertFetchResponse } from '@lib/utils/fetch/assertFetchResponse'

/**
 * MPC Relay Message format from core/mpc/message/relay
 */
export interface MpcRelayMessage {
  session_id: string
  from: string
  to: string[]
  body: string        // Encrypted with AES-GCM
  hash: string        // SHA-256 hash for deduplication
  sequence_no: number // Message ordering
}

/**
 * MessageRelayClient handles MPC message relay operations
 * Matches existing relay patterns from core/mpc/message/relay
 */
export class MessageRelayClient {
  private client: AxiosInstance

  constructor(baseURL: string = 'https://api.vultisig.com/router') {
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
   * Upload MPC message to relay server - POST /message/{sessionId}
   */
  async uploadMessage(sessionId: string, message: MpcRelayMessage): Promise<void> {
    await this.client.post(`/message/${sessionId}`, message)
  }

  /**
   * Get messages for local party from relay server - GET /message/{sessionId}/{localPartyId}
   * Returns array of pending encrypted messages
   */
  async getMessages(sessionId: string, localPartyId: string): Promise<MpcRelayMessage[]> {
    const response = await this.client.get(`/message/${sessionId}/${localPartyId}`)
    return response.data || []
  }

  /**
   * Delete processed message from relay server - DELETE /message/{sessionId}/{localPartyId}/{messageHash}
   * Prevents message replay and reduces server storage
   */
  async deleteMessage(sessionId: string, localPartyId: string, messageHash: string): Promise<void> {
    await this.client.delete(`/message/${sessionId}/${localPartyId}/${messageHash}`)
  }

  /**
   * Upload setup message for MPC session - POST /setup-message/{sessionId}
   * Used by initiating device to share session parameters
   */
  async uploadSetupMessage(sessionId: string, setupMessage: any): Promise<void> {
    await this.client.post(`/setup-message/${sessionId}`, setupMessage)
  }

  /**
   * Get setup message for MPC session - GET /setup-message/{sessionId}
   * Used by non-initiating devices to get session parameters
   */
  async getSetupMessage(sessionId: string): Promise<any> {
    const response = await this.client.get(`/setup-message/${sessionId}`)
    return response.data
  }

  /**
   * Join MPC session - POST /{sessionId}
   * Registers party ID with session for message routing
   */
  async joinSession(sessionId: string, partyId: string): Promise<void> {
    await this.client.post(`/${sessionId}`, { partyId })
  }

  /**
   * Ping relay server for health check - GET /ping
   */
  async ping(): Promise<number> {
    const start = Date.now()
    await this.client.get('/ping')
    return Date.now() - start
  }

  // ===== Message Encryption Utilities =====

  /**
   * Encrypt message body for relay server transmission
   */
  encryptMessage(body: Uint8Array, hexEncryptionKey: string): string {
    return toMpcServerMessage(body, hexEncryptionKey)
  }

  /**
   * Decrypt message body from relay server
   */
  decryptMessage(encryptedBody: string, hexEncryptionKey: string): Buffer {
    return fromMpcServerMessage(encryptedBody, hexEncryptionKey)
  }

  /**
   * Create message hash for deduplication (SHA-256)
   * Uses Web Crypto in browsers, falls back to Node crypto when available
   */
  private async createMessageHash(message: Uint8Array): Promise<string> {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle) {
      const digest = await (globalThis as any).crypto.subtle.digest('SHA-256', message)
      const bytes = new Uint8Array(digest)
      let hex = ''
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0')
      }
      return hex
    }
    const { createHash } = await import('crypto')
    return createHash('sha256').update(Buffer.from(message)).digest('hex')
  }

  // ===== High-level MPC Message Handling =====

  /**
   * Send encrypted MPC message with proper formatting
   */
  async sendMpcMessage(params: {
    sessionId: string
    from: string
    to: string[]
    messageBody: Uint8Array
    hexEncryptionKey: string
    sequenceNo: number
  }): Promise<void> {
    const encryptedBody = this.encryptMessage(params.messageBody, params.hexEncryptionKey)
    const messageHash = await this.createMessageHash(params.messageBody)

    const relayMessage: MpcRelayMessage = {
      session_id: params.sessionId,
      from: params.from,
      to: params.to,
      body: encryptedBody,
      hash: messageHash,
      sequence_no: params.sequenceNo
    }

    await this.uploadMessage(params.sessionId, relayMessage)
  }

  /**
   * Receive and decrypt MPC messages for local party
   */
  async receiveMpcMessages(
    sessionId: string, 
    localPartyId: string, 
    hexEncryptionKey: string
  ): Promise<{
    from: string
    body: Buffer
    hash: string
    sequenceNo: number
  }[]> {
    const messages = await this.getMessages(sessionId, localPartyId)
    
    return messages.map(msg => ({
      from: msg.from,
      body: this.decryptMessage(msg.body, hexEncryptionKey),
      hash: msg.hash,
      sequenceNo: msg.sequence_no
    }))
  }

  /**
   * Acknowledge processed message (delete from server)
   */
  async acknowledgeMessage(sessionId: string, localPartyId: string, messageHash: string): Promise<void> {
    await this.deleteMessage(sessionId, localPartyId, messageHash)
  }
}
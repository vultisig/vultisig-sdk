import axios, { type AxiosInstance } from 'axios'
import { toMpcServerMessage, fromMpcServerMessage } from '@core/mpc/message/server'
import type { MpcRelayMessage } from '@core/mpc/message/relay'
import { uploadMpcSetupMessage } from '@core/mpc/message/setup/upload'
import { waitForSetupMessage } from '@core/mpc/message/setup/get'
import { assertFetchResponse } from '@lib/utils/fetch/assertFetchResponse'
import { pingServer } from './utils'

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
      }
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
   * Upload setup message for MPC session using core implementation
   * Used by initiating device to share session parameters
   */
  async uploadSetupMessage(sessionId: string, setupMessage: any): Promise<void> {
    await uploadMpcSetupMessage({
      serverUrl: this.client.defaults.baseURL!,
      sessionId,
      message: setupMessage
    })
  }

  /**
   * Get setup message for MPC session using core implementation with retry logic
   * Used by non-initiating devices to get session parameters
   */
  async getSetupMessage(sessionId: string): Promise<any> {
    return waitForSetupMessage({
      serverUrl: this.client.defaults.baseURL!,
      sessionId
    })
  }

  /**
   * Join MPC session - POST /{sessionId}
   * Registers party ID with session for message routing
   */
  async joinSession(sessionId: string, partyId: string): Promise<void> {
    // FAST-SIGNING.md: body should be an array of participant ids
    await this.client.post(`/${sessionId}`, [partyId])
  }

  /**
   * Mark session started - POST /start/{sessionId}
   * Optional marker per FAST-SIGNING.md
   */
  async markSessionStarted(sessionId: string): Promise<void> {
    await this.client.post(`/start/${sessionId}`)
  }

  /**
   * Ping relay server for health check
   */
  async ping(): Promise<number> {
    return pingServer(this.client.defaults.baseURL!, '/ping')
  }


  /**
   * Create message hash for deduplication (SHA-256)
   */
  private async createMessageHash(message: Uint8Array): Promise<string> {
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
    const encryptedBody = toMpcServerMessage(params.messageBody, params.hexEncryptionKey)
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
      body: fromMpcServerMessage(msg.body, hexEncryptionKey),
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
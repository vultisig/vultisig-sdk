import * as crypto from 'crypto'
import { VaultData } from '../vault/VaultLoader'
import { SigningResult } from '../signing/SigningManager'
import { MpcSession } from './MpcMediatorServer'

// Import the actual Schnorr WASM library (temporarily disabled for testing)
// import { SignSession, Keyshare, Message } from '../../../../lib/schnorr/vs_schnorr_wasm'
// import initSchnorrWasm from '../../../../lib/schnorr/vs_schnorr_wasm'

// Mock types for testing
interface SignSession {
  outputMessage(): { body: Uint8Array; receivers: string[] } | undefined
  inputMessage(message: Uint8Array): boolean
  finish(): Uint8Array
  free(): void
}

interface Keyshare {
  keyId(): Uint8Array
  fromBytes(bytes: Uint8Array): Keyshare
}

interface Message {
  body: Uint8Array
  receivers: string[]
}

interface MpcRelayMessage {
  session_id: string
  from: string
  to: string[]
  body: string
  hash: string
  sequence_no: number
}

export class SchnorrKeysignSession {
  private session: MpcSession
  private vault: VaultData
  private sequenceNo: number = 0
  private cache: Set<string> = new Set()
  private isComplete: boolean = false
  private signSession?: SignSession
  
  constructor(session: MpcSession, vault: VaultData) {
    this.session = session
    this.vault = vault
  }
  
  async executeKeysign(): Promise<SigningResult> {
    console.log(`🔐 Starting Schnorr keysign for session ${this.session.sessionId}`)
    
    try {
      // Initialize Schnorr WASM (temporarily disabled)
      // await initSchnorrWasm()
      
      // Create Schnorr sign session
      await this.createSignSession()
      
      // Wait for mobile app to join if no peers yet
      if (this.session.peers.length === 0) {
        await this.waitForPeers()
      }
      
      console.log(`👥 Peers joined: ${this.session.peers.join(', ')}`)
      
      // Process outbound and inbound messages concurrently
      const outboundPromise = this.processOutbound()
      const inboundPromise = this.processInbound()
      
      // Wait for both to complete
      await Promise.all([outboundPromise, inboundPromise])
      
      if (!this.isComplete || !this.signSession) {
        throw new Error('Schnorr keysign session did not complete successfully')
      }
      
      // Get final signature
      const signature = this.signSession.finish()
      
      // Clean up WASM resources
      this.signSession.free()
      
      return this.formatSignature(signature)
      
    } catch (error) {
      console.error('❌ Schnorr keysign failed:', error)
      if (this.signSession) {
        this.signSession.free()
      }
      throw error
    }
  }
  
  private async createSignSession(): Promise<void> {
    try {
      // Create a mock Schnorr sign session for testing
      this.signSession = {
        outputMessage: () => {
          // Mock outbound message generation
          if (this.session.peers.length > 0) {
            const messageData = new Uint8Array(Buffer.from(JSON.stringify({
              type: 'schnorr_round',
              sessionId: this.session.sessionId,
              localParty: this.session.localPartyId,
              timestamp: Date.now()
            })))
            
            return {
              body: messageData,
              receivers: this.session.peers
            }
          }
          return undefined
        },
        
        inputMessage: (message: Uint8Array): boolean => {
          // Mock inbound message processing
          try {
            const messageStr = Buffer.from(message).toString('utf8')
            const parsed = JSON.parse(messageStr)
            console.log(`📨 Processed Schnorr message: ${parsed.type}`)
            
            // Simulate completion after receiving response
            if (parsed.type === 'schnorr_response') {
              setTimeout(() => {
                this.isComplete = true
              }, 1000)
              return true
            }
          } catch (error) {
            console.warn('⚠️ Failed to parse message:', error)
          }
          return false
        },
        
        finish: (): Uint8Array => {
          // Generate mock EdDSA signature (32 bytes R + 32 bytes S)
          const r = crypto.randomBytes(32)
          const s = crypto.randomBytes(32)
          return new Uint8Array([...r, ...s])
        },
        
        free: () => {
          // Mock cleanup
        }
      } as SignSession
      
      console.log('✅ Mock Schnorr sign session created successfully')
      
    } catch (error) {
      console.error('❌ Failed to create Schnorr sign session:', error)
      throw error
    }
  }
  
  private async waitForPeers(): Promise<void> {
    console.log('⏳ Waiting for mobile app to join MPC session...')
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for peers to join'))
      }, 120000) // 2 minute timeout
      
      const checkPeers = () => {
        // In a real implementation, this would check the relay server for joined peers
        // For mock purposes, simulate a peer joining after 5 seconds
        if (this.session.peers.length === 0) {
          setTimeout(() => {
            this.session.peers.push('mobile-device')
            console.log('📱 Mobile app joined the session')
            clearTimeout(timeout)
            resolve()
          }, 5000)
        } else {
          clearTimeout(timeout)
          resolve()
        }
      }
      
      checkPeers()
    })
  }
  
  private async processOutbound(): Promise<void> {
    while (!this.isComplete && this.signSession) {
      try {
        const message = this.signSession.outputMessage()
        if (!message) {
          await this.sleep(100)
          continue
        }
        
        console.log(`📤 Sending Schnorr message to ${message.receivers.join(', ')}`)
        
        // Send message to each receiver
        for (const receiver of message.receivers) {
          const mpcMessage: MpcRelayMessage = {
            session_id: this.session.sessionId,
            from: this.session.localPartyId,
            to: [receiver],
            body: this.encryptMessage(message.body, this.session.hexEncryptionKey),
            hash: this.getMessageHash(message.body),
            sequence_no: this.sequenceNo++
          }
          
          // Send to MPC relay server
          await this.sendMpcRelayMessage(mpcMessage)
        }
        
        await this.sleep(100)
        
      } catch (error) {
        console.error('❌ Error in outbound processing:', error)
        await this.sleep(500)
      }
    }
  }
  
  private async processInbound(): Promise<void> {
    const startTime = Date.now()
    const maxWaitTime = 60000 // 1 minute
    
    while (!this.isComplete && this.signSession) {
      try {
        // Check for timeout
        if (Date.now() - startTime > maxWaitTime) {
          throw new Error('Timeout waiting for Schnorr messages')
        }
        
        // Get messages from relay server
        const messages = await this.getMpcRelayMessages()
        
        if (messages.length === 0) {
          await this.sleep(500)
          continue
        }
        
        for (const msg of messages) {
          const cacheKey = `${msg.session_id}-${msg.from}-${msg.hash}`
          if (this.cache.has(cacheKey)) {
            continue // Already processed
          }
          
          console.log(`📥 Processing Schnorr message from ${msg.from}`)
          
          // Decrypt and process message
          const decryptedMessage = this.decryptMessage(msg.body, this.session.hexEncryptionKey)
          const isFinished = this.signSession.inputMessage(decryptedMessage)
          
          this.cache.add(cacheKey)
          
          // Delete processed message from relay server
          await this.deleteMpcRelayMessage(msg.hash)
          
          if (isFinished) {
            this.isComplete = true
            console.log('✅ Schnorr keysign completed')
            return
          }
        }
        
        await this.sleep(100)
        
      } catch (error) {
        console.error('❌ Error in inbound processing:', error)
        await this.sleep(500)
      }
    }
  }
  
  private async sendMpcRelayMessage(message: MpcRelayMessage): Promise<void> {
    try {
      const response = await fetch(`${this.session.serverUrl}/message/${this.session.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      })
      
      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status} ${response.statusText}`)
      }
      
      console.log(`📡 Sent MPC message: ${message.from} -> ${message.to.join(', ')}`)
    } catch (error) {
      console.error('❌ Failed to send MPC relay message:', error)
      throw error
    }
  }
  
  private async getMpcRelayMessages(): Promise<MpcRelayMessage[]> {
    try {
      const response = await fetch(
        `${this.session.serverUrl}/message/${this.session.sessionId}/${encodeURIComponent(this.session.localPartyId)}`,
        {
          method: 'GET'
        }
      )
      
      if (!response.ok) {
        if (response.status === 404) {
          return [] // No messages
        }
        throw new Error(`Failed to get messages: ${response.status} ${response.statusText}`)
      }
      
      const messages = await response.json()
      return messages as MpcRelayMessage[]
    } catch (error) {
      console.error('❌ Failed to get MPC relay messages:', error)
      return [] as MpcRelayMessage[]
    }
  }
  
  private async deleteMpcRelayMessage(hash: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.session.serverUrl}/message/${this.session.sessionId}/${encodeURIComponent(this.session.localPartyId)}/${hash}`,
        {
          method: 'DELETE'
        }
      )
      
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete message: ${response.status} ${response.statusText}`)
      }
      
      console.log(`🗑️ Deleted MPC message: ${hash}`)
    } catch (error) {
      console.warn('⚠️ Failed to delete MPC relay message:', error)
      // Don't throw here as it's not critical
    }
  }
  
  private encryptMessage(message: Uint8Array, hexKey: string): string {
    try {
      const key = Buffer.from(hexKey, 'hex')
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
      
      let encrypted = cipher.update(Buffer.from(message))
      encrypted = Buffer.concat([encrypted, cipher.final()])
      
      return Buffer.concat([iv, encrypted]).toString('base64')
    } catch (error) {
      console.warn('⚠️ Encryption failed, using plain text')
      return Buffer.from(message).toString('base64')
    }
  }
  
  private decryptMessage(encryptedMessage: string, hexKey: string): Uint8Array {
    try {
      const key = Buffer.from(hexKey, 'hex')
      const data = Buffer.from(encryptedMessage, 'base64')
      const iv = data.slice(0, 16)
      const encrypted = data.slice(16)
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
      let decrypted = decipher.update(encrypted)
      decrypted = Buffer.concat([decrypted, decipher.final()])
      
      return new Uint8Array(decrypted)
    } catch (error) {
      console.warn('⚠️ Decryption failed, treating as plain text')
      return new Uint8Array(Buffer.from(encryptedMessage, 'base64'))
    }
  }
  
  private getMessageHash(message: Uint8Array): string {
    return crypto.createHash('sha256').update(message).digest('hex')
  }
  
  private formatSignature(signature: Uint8Array): SigningResult {
    // Schnorr signatures are different from ECDSA
    // Format: 32 bytes R + 32 bytes S (no recovery ID for EdDSA)
    const r = Buffer.from(signature.slice(0, 32)).toString('hex')
    const s = Buffer.from(signature.slice(32, 64)).reverse().toString('hex') // EdDSA reverses S
    
    return {
      signature: `${r}${s}`,
      raw: Buffer.from(signature).toString('hex'),
      txId: crypto.randomBytes(32).toString('hex') // Mock transaction ID
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
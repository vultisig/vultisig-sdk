import * as crypto from 'crypto'
import { SignSession, Keyshare } from '@lib/dkls/vs_wasm'
import { initializeMpcLib } from '@core/mpc/lib/initialize'
import { toMpcLibKeyshare } from '@core/mpc/lib/keyshare'
import { VaultData } from '../vault/VaultLoader'
import { SigningResult } from '../signing/SigningManager'
import { MpcSession } from './MpcMediatorServer'

interface MpcRelayMessage {
  session_id: string
  from: string
  to: string[]
  body: string
  hash: string
  sequence_no: number
}

export class DklsKeysignSession {
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
    console.log(`🔐 Starting DKLS keysign for session ${this.session.sessionId}`)
    
    try {
      // Initialize DKLS WASM library
      await initializeMpcLib('ecdsa')
      console.log('✅ DKLS WASM library initialized')
      
      // Create DKLS sign session
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
        throw new Error('DKLS keysign session did not complete successfully')
      }
      
      // Get final signature
      const signature = this.signSession.finish()
      
      // Clean up WASM resources
      this.signSession.free()
      
      return this.formatSignature(signature)
      
    } catch (error) {
      console.error('❌ DKLS keysign failed:', error)
      if (this.signSession) {
        this.signSession.free()
      }
      throw error
    }
  }
  
  private async createSignSession(): Promise<void> {
    try {
      // Create a mock DKLS sign session for testing
      this.signSession = {
        outputMessage: () => {
          // Mock outbound message generation
          if (this.session.peers.length > 0) {
            const messageData = new Uint8Array(Buffer.from(JSON.stringify({
              type: 'dkls_round',
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
            console.log(`📨 Processed DKLS message: ${parsed.type}`)
            
            // Simulate completion after receiving response
            if (parsed.type === 'dkls_response') {
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
          // Generate mock ECDSA signature
          const r = crypto.randomBytes(32)
          const s = crypto.randomBytes(32)
          const recovery = new Uint8Array([0])
          return new Uint8Array([...r, ...s, ...recovery])
        },
        
        free: () => {
          // Mock cleanup
        }
      } as SignSession
      
      console.log('✅ Mock DKLS sign session created successfully')
      
    } catch (error) {
      console.error('❌ Failed to create DKLS sign session:', error)
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
        
        console.log(`📤 Sending DKLS message to ${message.receivers.join(', ')}`)
        
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
          throw new Error('Timeout waiting for DKLS messages')
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
          
          console.log(`📥 Processing DKLS message from ${msg.from}`)
          
          // Decrypt and process message
          const decryptedMessage = this.decryptMessage(msg.body, this.session.hexEncryptionKey)
          const isFinished = this.signSession.inputMessage(decryptedMessage)
          
          this.cache.add(cacheKey)
          
          // Delete processed message from relay server
          await this.deleteMpcRelayMessage(msg.hash)
          
          if (isFinished) {
            this.isComplete = true
            console.log('✅ DKLS keysign completed')
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
    const r = Buffer.from(signature.slice(0, 32)).toString('hex')
    const s = Buffer.from(signature.slice(32, 64)).toString('hex')
    const recoveryId = signature[64].toString(16).padStart(2, '0')
    
    // Create DER encoded signature
    const derSignature = this.encodeDERSignature(signature.slice(0, 32), signature.slice(32, 64))
    
    return {
      signature: `0x${r}${s}${recoveryId}`,
      raw: `0x${Buffer.from(derSignature).toString('hex')}`,
      txId: crypto.randomBytes(32).toString('hex') // Mock transaction ID
    }
  }
  
  private encodeDERSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
    // Simple DER encoding for ECDSA signature
    const rBytes = Array.from(r)
    const sBytes = Array.from(s)
    
    // Add 0x00 prefix if first bit is set (to indicate positive number)
    if (rBytes[0] >= 0x80) rBytes.unshift(0x00)
    if (sBytes[0] >= 0x80) sBytes.unshift(0x00)
    
    const rLen = rBytes.length
    const sLen = sBytes.length
    const totalLen = 4 + rLen + sLen // 2 bytes for R header + 2 bytes for S header + data
    
    return new Uint8Array([
      0x30, totalLen,          // SEQUENCE header
      0x02, rLen, ...rBytes,   // INTEGER R
      0x02, sLen, ...sBytes    // INTEGER S
    ])
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
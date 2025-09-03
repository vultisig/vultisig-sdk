import * as http from 'http'
import express from 'express'
import * as crypto from 'crypto'
import { VaultData } from '../vault/VaultLoader'
import { KeysignWebServer } from '../web/KeysignWebServer'
import { SigningRequest, SigningResult } from '../signing/SigningManager'
import { DklsKeysignSession } from './DklsKeysignSession'
import { SchnorrKeysignSession } from './SchnorrKeysignSession'

export interface MpcSession {
  sessionId: string
  localPartyId: string
  peers: string[]
  serverUrl: string
  hexEncryptionKey: string
  keyshare: string
  signatureAlgorithm: 'ecdsa' | 'eddsa'
  message: string
  chainPath: string
  isComplete: boolean
  result?: SigningResult
  error?: string
}

export interface MpcRelayMessage {
  session_id: string
  from: string
  to: string[]
  body: string
  hash: string
  sequence_no: number
}

export class MpcMediatorServer {
  private server: http.Server
  private app: express.Application
  private port: number = 18080
  private vault: VaultData
  private webServer?: KeysignWebServer
  private sessions: Map<string, MpcSession> = new Map()
  private messages: Map<string, MpcRelayMessage[]> = new Map()
  private setupMessages: Map<string, string> = new Map()
  private payloadMessages: Map<string, string> = new Map()
  private keysignComplete: Map<string, any> = new Map()
  
  constructor(vault: VaultData) {
    this.vault = vault
    this.app = express()
    this.setupRoutes()
    this.server = http.createServer(this.app)
  }
  
  private setupRoutes(): void {
    // Middleware
    this.app.use(express.json({ limit: '100MB' }))
    this.app.use(express.text({ limit: '100MB' }))
    
    // Simple CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type, message_id')
      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
      } else {
        next()
      }
    })
    
    // Health check
    this.app.get('/ping', (req, res) => {
      res.status(200).send('Vultisig MPC Mediator is running')
    })
    
    // Session management
    this.app.post('/:sessionID', this.startSession.bind(this))
    this.app.get('/:sessionID', this.getSession.bind(this))
    this.app.delete('/:sessionID', this.deleteSession.bind(this))
    
    // Message handling
    this.app.post('/message/:sessionID', this.postMessage.bind(this))
    this.app.get('/message/:sessionID/:participantID', this.getMessage.bind(this))
    this.app.delete('/message/:sessionID/:participantID/:hash', this.deleteMessage.bind(this))
    
    // TSS session coordination
    this.app.post('/start/:sessionID', this.startTSSSession.bind(this))
    this.app.get('/start/:sessionID', this.getStartTSSSession.bind(this))
    this.app.post('/complete/:sessionID', this.setCompleteTSSSession.bind(this))
    this.app.get('/complete/:sessionID', this.getCompleteTSSSession.bind(this))
    
    // Keysign completion
    this.app.post('/complete/:sessionID/keysign', this.setKeysignFinished.bind(this))
    this.app.get('/complete/:sessionID/keysign', this.getKeysignFinished.bind(this))
    
    // Payload handling
    this.app.post('/payload/:hash', this.handlePayloadMessage.bind(this))
    this.app.get('/payload/:hash', this.getPayloadMessage.bind(this))
    
    // Setup message handling
    this.app.post('/setup-message/:sessionID', this.postSetupMessage.bind(this))
    this.app.get('/setup-message/:sessionID', this.getSetupMessage.bind(this))
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`🚀 MPC Mediator Server running on port ${this.port}`)
        resolve()
      })
      
      this.server.on('error', (error) => {
        console.error('❌ MPC Mediator Server error:', error)
        reject(error)
      })
    })
  }
  
  async stop(): Promise<void> {
    // Stop mDNS advertisement (disabled for now)
    // if (this.mdnsAd) {
    //   this.mdnsAd.stop()
    //   this.mdnsAd = undefined
    // }
    
    // Stop web server
    if (this.webServer) {
      await this.webServer.stop()
    }
    
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('✅ MPC Mediator Server stopped')
        resolve()
      })
    })
  }
  
  async advertiseViaMdns(name: string): Promise<void> {
    // TODO: Re-enable mDNS when dependencies are available
    console.log(`📡 MPC Mediator would advertise as '${name}' on port ${this.port} (mDNS disabled for now)`)
  }
  
  async signTransaction(request: SigningRequest): Promise<SigningResult> {
    console.log(`🔐 Starting MPC signing for ${request.network} (${request.scheme})`)
    
    // Generate session parameters
    const sessionId = request.sessionId || this.generateSessionId()
    const hexEncryptionKey = request.hexEncryptionKey || this.generateEncryptionKey()
    const serverUrl = request.serverUrl || `http://127.0.0.1:${this.port}`
    const localPartyId = this.vault.localPartyId || 'cli-device'
    
    // Get appropriate keyshare for the signature scheme
    const keyshare = this.getKeyShareForScheme(request.scheme)
    if (!keyshare) {
      throw new Error(`No ${request.scheme} keyshare available in vault`)
    }
    
    // Convert transaction payload to hex message
    const message = this.createMessageFromPayload(request)
    const chainPath = this.getChainPath(request.network, request.scheme)
    
    // Create MPC session
    const session: MpcSession = {
      sessionId,
      localPartyId,
      peers: request.peers || [],
      serverUrl,
      hexEncryptionKey,
      keyshare,
      signatureAlgorithm: request.scheme,
      message,
      chainPath,
      isComplete: false
    }
    
    this.sessions.set(sessionId, session)
    
    console.log(`🔄 MPC Session: ${sessionId}`)
    console.log(`🌐 Server: ${serverUrl}`)
    console.log(`👥 Peers: ${session.peers.length > 0 ? session.peers.join(', ') : 'Waiting for mobile app...'}`)
    
    try {
      // Start web interface for QR code display
      await this.startWebInterface(request, session)
      
      // Start appropriate keysign session based on signature algorithm
      let result: SigningResult
      if (request.scheme === 'ecdsa') {
        const dklsSession = new DklsKeysignSession(session, this.vault)
        result = await dklsSession.executeKeysign()
      } else {
        const schnorrSession = new SchnorrKeysignSession(session, this.vault)
        result = await schnorrSession.executeKeysign()
      }
      
      session.result = result
      session.isComplete = true
      
      console.log('✅ MPC signing completed successfully!')
      console.log(`   Signature: ${result.signature}`)
      
      // Update web interface with success
      if (this.webServer) {
        this.webServer.setSigningComplete(true, result.txId || 'signed')
      }
      
      return result
      
    } catch (error) {
      session.error = error instanceof Error ? error.message : String(error)
      session.isComplete = true
      
      console.error('❌ MPC signing failed:', error)
      
      // Update web interface with error
      if (this.webServer) {
        this.webServer.setSigningComplete(false, undefined, session.error)
      }
      
      throw error
    }
  }
  
  private async startWebInterface(request: SigningRequest, session: MpcSession): Promise<void> {
    try {
      // Create keysign payload for QR code
      const keysignPayload = await this.createKeysignPayload(request)
      
      this.webServer = new KeysignWebServer({
        sessionId: session.sessionId,
        vaultData: this.vault,
        keysignPayload,
        useVultisigRelay: session.serverUrl !== `http://127.0.0.1:${this.port}`
      })
      
      const webUrl = await this.webServer.start()
      console.log(`\\n🌐 Keysign web interface available at: ${webUrl}`)
      
      // Update status to waiting for mobile
      this.webServer.updateStatus('waiting_for_mobile', 'Scan QR code with Vultisig mobile app')
      
    } catch (error) {
      console.error('❌ Failed to start web interface:', error)
      throw error
    }
  }
  
  private createMessageFromPayload(request: SigningRequest): string {
    // This would normally create the actual message hash from the transaction payload
    // For now, create a placeholder based on the payload
    const payloadStr = JSON.stringify(request.payload)
    const hash = crypto.createHash('sha256').update(payloadStr).digest('hex')
    return hash
  }
  
  private async createKeysignPayload(request: SigningRequest): Promise<any> {
    // Create a mock keysign payload structure for QR code generation
    // This should match the KeysignPayload protobuf structure
    return {
      coin: {
        chain: request.network.toUpperCase(),
        ticker: this.getTickerForNetwork(request.network),
        address: '', // Will be derived
        decimals: 18,
        hexPublicKey: request.scheme === 'ecdsa' ? this.vault.publicKeyEcdsa : this.vault.publicKeyEddsa
      },
      toAddress: request.payload.to || '',
      toAmount: request.payload.value?.toString() || '0',
      memo: request.payload.memo || '',
      vaultPublicKeyEcdsa: this.vault.publicKeyEcdsa,
      vaultLocalPartyId: this.vault.localPartyId || '',
      libType: 'DKLS'
    }
  }
  
  private getKeyShareForScheme(scheme: 'ecdsa' | 'eddsa'): string | null {
    if (this.vault.keyShares.length === 0) {
      return null
    }
    
    // Find keyshare matching the public key for the scheme
    const publicKey = scheme === 'ecdsa' ? this.vault.publicKeyEcdsa : this.vault.publicKeyEddsa
    const keyShare = this.vault.keyShares.find(ks => ks.publicKey === publicKey)
    
    return keyShare?.keyshare || this.vault.keyShares[0].keyshare
  }
  
  private getChainPath(network: string, scheme: 'ecdsa' | 'eddsa'): string {
    if (scheme === 'eddsa') {
      return 'm' // EdDSA uses placeholder path
    }
    
    // ECDSA derivation paths
    const paths: Record<string, string> = {
      'eth': "m/44'/60'/0'/0/0",
      'btc': "m/84'/0'/0'/0/0", 
      'sol': "m/44'/501'/0'/0'",
      'ltc': "m/84'/2'/0'/0/0",
      'doge': "m/44'/3'/0'/0/0"
    }
    
    return paths[network.toLowerCase()] || "m/44'/0'/0'/0/0"
  }
  
  private getTickerForNetwork(network: string): string {
    const tickers: Record<string, string> = {
      'eth': 'ETH',
      'btc': 'BTC',
      'sol': 'SOL',
      'ltc': 'LTC',
      'doge': 'DOGE'
    }
    
    return tickers[network.toLowerCase()] || network.toUpperCase()
  }
  
  private generateSessionId(): string {
    return `cli-${crypto.randomBytes(8).toString('hex')}`
  }
  
  private generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex')
  }
  
  // Express route handlers for MPC relay functionality
  
  private startSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const participants = req.body as string[]
    if (!Array.isArray(participants)) {
      res.status(400).send()
      return
    }
    
    // Store session participants
    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, [])
    }
    
    console.log(`📝 Started session ${sessionID} with participants:`, participants)
    res.status(201).send()
  }
  
  private getSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const session = this.sessions.get(sessionID)
    if (!session) {
      res.status(404).send()
      return
    }
    
    res.json([session.localPartyId, ...session.peers])
  }
  
  private deleteSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    this.sessions.delete(sessionID)
    this.messages.delete(sessionID)
    this.setupMessages.delete(sessionID)
    
    console.log(`🗑️ Deleted session ${sessionID}`)
    res.status(200).send()
  }
  
  private postMessage(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const message = req.body as MpcRelayMessage
    if (!message.from || !message.to || !message.body) {
      res.status(400).send()
      return
    }
    
    // Store message for each recipient
    message.to.forEach(recipient => {
      const key = `${sessionID}-${recipient}`
      if (!this.messages.has(key)) {
        this.messages.set(key, [])
      }
      this.messages.get(key)!.push(message)
    })
    
    console.log(`📨 Stored message from ${message.from} to ${message.to.join(', ')} in session ${sessionID}`)
    res.status(202).send()
  }
  
  private getMessage(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    const participantID = decodeURIComponent(req.params.participantID?.trim() || '')
    
    if (!sessionID || !participantID) {
      res.status(400).send()
      return
    }
    
    const key = `${sessionID}-${participantID}`
    const messages = this.messages.get(key) || []
    
    res.json(messages)
  }
  
  private deleteMessage(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    const participantID = decodeURIComponent(req.params.participantID?.trim() || '')
    const hash = req.params.hash?.trim()
    
    if (!sessionID || !participantID || !hash) {
      res.status(400).send()
      return
    }
    
    const key = `${sessionID}-${participantID}`
    const messages = this.messages.get(key) || []
    const filteredMessages = messages.filter(msg => msg.hash !== hash)
    this.messages.set(key, filteredMessages)
    
    res.status(200).send()
  }
  
  private startTSSSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const participants = req.body as string[]
    const key = `start-${sessionID}`
    // Store TSS session start info (simplified)
    console.log(`🔄 Started TSS session ${sessionID} with participants:`, participants)
    res.status(200).send()
  }
  
  private getStartTSSSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const session = this.sessions.get(sessionID)
    if (!session) {
      res.status(404).send()
      return
    }
    
    res.json([session.localPartyId, ...session.peers])
  }
  
  private setCompleteTSSSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    console.log(`✅ TSS session ${sessionID} completed`)
    res.status(200).send()
  }
  
  private getCompleteTSSSession(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const session = this.sessions.get(sessionID)
    if (!session || !session.isComplete) {
      res.status(404).send()
      return
    }
    
    res.json([session.localPartyId, ...session.peers])
  }
  
  private setKeysignFinished(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const messageID = req.get('message_id') || ''
    const key = `keysign-${sessionID}-${messageID}-complete`
    const body = req.body
    
    this.keysignComplete.set(key, body)
    
    console.log(`✅ Keysign finished for session ${sessionID}`)
    res.status(200).send()
  }
  
  private getKeysignFinished(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const messageID = req.get('message_id') || ''
    const key = `keysign-${sessionID}-${messageID}-complete`
    const result = this.keysignComplete.get(key)
    
    if (!result) {
      res.status(404).send()
      return
    }
    
    res.send(result)
  }
  
  private handlePayloadMessage(req: express.Request, res: express.Response): void {
    const hash = req.params.hash?.trim()
    if (!hash) {
      res.status(400).send()
      return
    }
    
    const payload = req.body
    const calculatedHash = crypto.createHash('sha256').update(payload).digest('hex')
    
    if (calculatedHash !== hash) {
      console.error(`Hash mismatch: expected ${hash}, got ${calculatedHash}`)
      res.status(400).send()
      return
    }
    
    this.payloadMessages.set(hash, payload)
    res.status(200).send()
  }
  
  private getPayloadMessage(req: express.Request, res: express.Response): void {
    const hash = req.params.hash?.trim()
    if (!hash) {
      res.status(400).send()
      return
    }
    
    const payload = this.payloadMessages.get(hash)
    if (!payload) {
      res.status(404).send()
      return
    }
    
    res.send(payload)
  }
  
  private postSetupMessage(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const messageID = req.get('message_id') || ''
    const key = messageID ? `setup-${sessionID}-${messageID}` : `setup-${sessionID}`
    const body = req.body
    
    this.setupMessages.set(key, body)
    
    console.log(`📤 Stored setup message for session ${sessionID}`)
    res.status(201).send()
  }
  
  private getSetupMessage(req: express.Request, res: express.Response): void {
    const sessionID = req.params.sessionID?.trim()
    if (!sessionID) {
      res.status(400).send()
      return
    }
    
    const messageID = req.get('message_id') || ''
    const key = messageID ? `setup-${sessionID}-${messageID}` : `setup-${sessionID}`
    const setupMessage = this.setupMessages.get(key)
    
    if (!setupMessage) {
      res.status(404).send()
      return
    }
    
    res.send(setupMessage)
  }
}
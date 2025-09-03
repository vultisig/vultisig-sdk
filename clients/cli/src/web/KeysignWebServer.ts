import express from 'express'
import * as path from 'path'
import * as http from 'http'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { KeysignUriGenerator } from '../keysign/KeysignUriGenerator'
import { QrCodeGenerator } from '../keysign/QrCodeGenerator'
import { VaultData } from '../vault/VaultLoader'

export interface KeysignWebServerOptions {
  port?: number
  sessionId: string
  vaultData: VaultData
  keysignPayload: KeysignPayload
  useVultisigRelay: boolean
  onSigningComplete?: (result: any) => void
  onSigningError?: (error: Error) => void
}

export type KeysignStatus = 
  | 'waiting_for_mobile'
  | 'peer_discovered' 
  | 'joining'
  | 'round1'
  | 'round2' 
  | 'round3'
  | 'complete'
  | 'success'
  | 'error'

export class KeysignWebServer {
  private app: express.Application
  private server?: http.Server
  private options: KeysignWebServerOptions
  private uriGenerator: KeysignUriGenerator
  private qrGenerator: QrCodeGenerator
  
  // Status tracking
  private currentStatus: KeysignStatus = 'waiting_for_mobile'
  private statusMessage: string = 'Waiting for mobile app to scan QR code...'
  private connectedPeers: string[] = []
  private signingComplete: boolean = false
  private txHash?: string
  private errorMessage?: string
  
  constructor(options: KeysignWebServerOptions) {
    this.options = options
    this.app = express()
    this.uriGenerator = new KeysignUriGenerator()
    this.qrGenerator = new QrCodeGenerator()
    
    this.setupRoutes()
  }
  
  private setupRoutes() {
    // Serve static assets (CSS, JS, images)
    // For ts-node, __dirname is in src/web, so we go up two levels to reach web/static
    this.app.use('/static', express.static(path.join(__dirname, '../../web/static')))
    
    // Main keysign page
    this.app.get('/', async (req, res) => {
      try {
        const html = await this.generateKeysignPage()
        res.send(html)
      } catch (error) {
        console.error('Error generating keysign page:', error)
        res.status(500).send('Internal Server Error')
      }
    })
    
    // QR code API endpoint
    this.app.get('/api/qr', async (req, res) => {
      try {
        const format = req.query.format as string || 'png'
        const uri = await this.generateKeysignUri()
        
        if (format === 'svg') {
          const svg = await this.qrGenerator.generateSvg({ uri })
          res.setHeader('Content-Type', 'image/svg+xml')
          res.send(svg)
        } else if (format === 'dataurl') {
          const dataUrl = await this.qrGenerator.generateDataUrl({ uri })
          res.json({ dataUrl })
        } else {
          const png = await this.qrGenerator.generatePng({ uri })
          res.setHeader('Content-Type', 'image/png')
          res.send(png)
        }
      } catch (error) {
        console.error('Error generating QR code:', error)
        res.status(500).json({ error: 'Failed to generate QR code' })
      }
    })
    
    // Transaction details API
    this.app.get('/api/transaction', (req, res) => {
      res.json({
        sessionId: this.options.sessionId,
        vault: {
          name: this.options.vaultData.name,
          publicKeyEcdsa: this.options.vaultData.publicKeyEcdsa,
          signers: this.options.vaultData.signers
        },
        transaction: {
          coin: this.options.keysignPayload.coin,
          toAddress: this.options.keysignPayload.toAddress,
          toAmount: this.options.keysignPayload.toAmount,
          memo: this.options.keysignPayload.memo,
          blockchainSpecific: this.options.keysignPayload.blockchainSpecific
        },
        mode: this.options.useVultisigRelay ? 'relay' : 'local'
      })
    })
    
    // Status updates endpoint (WebSocket would be better, but keeping it simple)
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: this.currentStatus,
        message: this.statusMessage,
        peers: this.connectedPeers,
        signingComplete: this.signingComplete,
        txHash: this.txHash,
        error: this.errorMessage
      })
    })
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })
  }
  
  private async generateKeysignUri(): Promise<string> {
    const sessionParams = this.uriGenerator.generateSessionParams()
    
    return this.uriGenerator.generateKeysignUri({
      sessionId: sessionParams.sessionId,
      vaultId: this.options.vaultData.name || 'default',
      keysignPayload: this.options.keysignPayload,
      useVultisigRelay: this.options.useVultisigRelay,
      serviceName: sessionParams.serviceName,
      encryptionKeyHex: sessionParams.encryptionKeyHex
    })
  }
  
  private async generateKeysignPage(): Promise<string> {
    const uri = await this.generateKeysignUri()
    const qrDataUrl = await this.qrGenerator.generateDataUrl({ uri })
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vultisig Keysign - ${this.options.vaultData.name}</title>
      <link rel="stylesheet" href="/static/keysign.css">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <header class="header">
          <div class="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="16" fill="#3B82F6"/>
              <path d="M16 8L20 12H18V20H14V12H12L16 8Z" fill="white"/>
            </svg>
            <h1>Vultisig</h1>
          </div>
          <div class="mode-badge ${this.options.useVultisigRelay ? 'relay' : 'local'}">
            ${this.options.useVultisigRelay ? 'Relay Mode' : 'Local Mode'}
          </div>
        </header>
        
        <!-- Main Content -->
        <main class="main-content">
          <!-- QR Code Section -->
          <div class="qr-section">
            <div class="qr-container">
              <img src="${qrDataUrl}" alt="Keysign QR Code" class="qr-code" />
            </div>
            <h2>Join Keysign</h2>
            <p class="qr-description">Scan with your Vultisig mobile app to sign this transaction</p>
          </div>
          
          <!-- Transaction Details -->
          <div class="transaction-section">
            <h3>Transaction Details</h3>
            <div class="tx-overview-panel">
              <div class="tx-row">
                <span class="label">Vault:</span>
                <span class="value">${this.options.vaultData.name}</span>
              </div>
              <div class="tx-row">
                <span class="label">Session:</span>
                <span class="value">${this.options.sessionId}</span>
              </div>
              <div class="tx-row">
                <span class="label">Network:</span>
                <span class="value">${this.options.keysignPayload.coin?.chain || 'Unknown'}</span>
              </div>
              <div class="tx-row">
                <span class="label">To Address:</span>
                <span class="value address">${this.options.keysignPayload.toAddress}</span>
              </div>
              <div class="tx-row">
                <span class="label">Amount:</span>
                <span class="value">${this.options.keysignPayload.toAmount} ${this.options.keysignPayload.coin?.ticker || ''}</span>
              </div>
              ${this.options.keysignPayload.memo ? `
              <div class="tx-row">
                <span class="label">Memo:</span>
                <span class="value">${this.options.keysignPayload.memo}</span>
              </div>
              ` : ''}
            </div>
          </div>
          
          <!-- Status Section -->
          <div class="status-section">
            <div class="status-indicator waiting">
              <div class="status-icon">
                <div class="spinner"></div>
              </div>
              <div class="status-text">
                <h4>Waiting for Mobile App</h4>
                <p>Please scan the QR code with your mobile device to continue</p>
              </div>
            </div>
          </div>
        </main>
        
        <!-- Footer -->
        <footer class="footer">
          <p>Vultisig CLI - Secure Multi-Party Computation</p>
        </footer>
      </div>
      
      <script src="/static/keysign.js"></script>
    </body>
    </html>
    `
  }
  
  async start(): Promise<string> {
    const port = this.options.port || 0 // Use 0 for random available port
    
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, '127.0.0.1', () => {
        const address = this.server?.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to get server address'))
          return
        }
        
        const url = `http://127.0.0.1:${address.port}`
        console.log(`🌐 Keysign web interface started: ${url}`)
        resolve(url)
      })
      
      this.server.on('error', (error) => {
        reject(error)
      })
    })
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🌐 Keysign web server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
  
  // Status update methods for external use
  updateStatus(status: KeysignStatus, message?: string) {
    this.currentStatus = status
    if (message) {
      this.statusMessage = message
    }
    console.log(`🔄 Keysign status: ${status} - ${this.statusMessage}`)
  }
  
  addPeer(peerId: string) {
    if (!this.connectedPeers.includes(peerId)) {
      this.connectedPeers.push(peerId)
      this.updateStatus('peer_discovered', `Connected to ${this.connectedPeers.length} device(s)`)
    }
  }
  
  removePeer(peerId: string) {
    this.connectedPeers = this.connectedPeers.filter(id => id !== peerId)
  }
  
  setSigningComplete(success: boolean, txHash?: string, error?: string) {
    this.signingComplete = true
    if (success) {
      this.currentStatus = 'success'
      this.statusMessage = 'Transaction signed and broadcasted successfully!'
      this.txHash = txHash
    } else {
      this.currentStatus = 'error'
      this.statusMessage = error || 'Signing failed'
      this.errorMessage = error
    }
  }
  
  // Get current status for external monitoring
  getStatus() {
    return {
      status: this.currentStatus,
      message: this.statusMessage,
      peers: this.connectedPeers,
      signingComplete: this.signingComplete,
      txHash: this.txHash,
      error: this.errorMessage
    }
  }
}
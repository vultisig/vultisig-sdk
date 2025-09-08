import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
// SDK will be made available globally by the launcher
declare const VultisigSDK: any
type VaultClass = any
import { JsonRpcServer } from './JsonRpcServer'

export interface DaemonRequest {
  method: string
  params?: Record<string, any>
}

export interface DaemonResponse {
  success: boolean
  result?: any
  error?: string
}

export interface SignTransactionRequest {
  network: string
  payload: any
  signingMode?: 'fast' | 'relay' | 'local'
  sessionId?: string
  password?: string
}

export class DaemonManager {
  private readonly socketPath: string
  private readonly pidFile: string
  private jsonRpcServer?: JsonRpcServer
  private vault?: VaultClass
  
  constructor(
    socketPath: string = '/tmp/vultisig.sock',
    pidFile: string = '/tmp/vultisig.pid'
  ) {
    this.socketPath = socketPath
    this.pidFile = pidFile
  }
  
  async startDaemon(vault: VaultClass): Promise<void> {
    this.vault = vault
    
    // Create PID file
    await this.writePIDFile()
    
    // Setup signal handling for graceful shutdown
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'))
    process.on('SIGINT', () => this.handleShutdown('SIGINT'))
    
    // Start Unix socket server for daemon commands
    const server = await this.startUnixSocket()
    
    console.log(`🔌 Started Unix socket server at ${this.socketPath}`)
    console.log(`📝 Created PID file at ${this.pidFile}`)
    
    // Create JSON-RPC server instance for package communication
    this.jsonRpcServer = new JsonRpcServer(vault)
    console.log('📡 JSON-RPC handler integrated into main socket')
    
    // Handle incoming connections
    server.on('connection', (socket) => {
      this.handleConnection(socket)
    })
    
    // Keep process running
    return new Promise((resolve, reject) => {
      server.on('error', reject)
      // Process will be kept alive by the server
    })
  }
  
  async sendShutdownSignal(): Promise<void> {
    try {
      // First try Unix socket communication
      await this.sendSocketCommand('shutdown', {})
      console.log('✅ Shutdown signal sent via Unix socket')
      await this.waitForShutdown()
    } catch (error) {
      // Fallback to PID-based termination
      console.log('🔄 Unix socket failed, trying PID-based shutdown...')
      await this.shutdownByPID()
    }
  }
  
  async checkDaemonStatus(): Promise<void> {
    try {
      // Check if socket exists and is responsive
      await this.sendSocketCommand('ping', {})
      console.log('✅ Daemon is running and responsive')
    } catch (error) {
      // Check if PID file exists and process is running
      if (await this.isPIDFileValid()) {
        console.log('⚠️  Daemon PID file exists but socket is unresponsive')
        throw new Error('Daemon may be in an inconsistent state')
      }
      
      console.log('❌ Daemon is not running')
      throw new Error('Daemon is not running')
    }
  }

  async getAddresses(chains: string[]): Promise<Record<string, string>> {
    try {
      // Check if daemon is running first
      await this.sendSocketCommand('ping', {})
      
      // Request addresses from daemon
      const response = await this.sendSocketCommand('get_addresses', { chains })
      return response.addresses || {}
    } catch (error) {
      throw new Error('No Vultisig daemon running, start with "vultisig run" first')
    }
  }
  
  async signTransaction(request: SignTransactionRequest): Promise<any> {
    try {
      // Check if daemon is running first
      await this.sendSocketCommand('ping', {})
      
      // Send signing request to daemon
      const response = await this.sendSocketCommand('sign_transaction', request)
      return response
    } catch (error) {
      throw new Error('No Vultisig daemon running, start with "vultisig run" first')
    }
  }
  
  private async startUnixSocket(): Promise<net.Server> {
    // Remove existing socket if it exists
    try {
      await fs.promises.unlink(this.socketPath)
    } catch {
      // Socket doesn't exist, that's fine
    }
    
    const server = net.createServer()
    
    return new Promise((resolve, reject) => {
      server.listen(this.socketPath, () => {
        // Set socket permissions (owner only)
        fs.chmodSync(this.socketPath, 0o600)
        resolve(server)
      })
      
      server.on('error', reject)
    })
  }
  
  private async handleConnection(socket: net.Socket): Promise<void> {
    let buffer = ''
    
    socket.on('data', async (data) => {
      buffer += data.toString()
      
      // Process complete lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const request = JSON.parse(line.trim()) as DaemonRequest
            const response = await this.handleRequest(request)
            socket.write(JSON.stringify(response) + '\n')
          } catch (error) {
            const errorResponse: DaemonResponse = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
            socket.write(JSON.stringify(errorResponse) + '\n')
          }
        }
      }
    })
    
    socket.on('error', (error) => {
      console.error('Socket error:', error)
    })
  }
  
  private async handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
    try {
      switch (request.method) {
        case 'ping':
          return { success: true, result: 'pong' }
          
        case 'shutdown':
          // Graceful shutdown
          setTimeout(() => process.exit(0), 100)
          return { success: true, result: 'shutting down' }
          
        case 'get_addresses':
          if (!this.vault) {
            throw new Error('No vault loaded')
          }
          
          const chains = request.params?.chains || ['bitcoin', 'ethereum', 'solana']
          const addresses: Record<string, string> = {}
          
          for (const chain of chains) {
            try {
              addresses[chain] = await (this.vault as any).address(chain)
            } catch (error) {
              addresses[chain] = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          }
          
          return { success: true, result: { addresses } }
          
        case 'sign_transaction':
          if (!this.vault) {
            throw new Error('No vault loaded')
          }
          
          const signRequest = request.params as SignTransactionRequest
          const signature = await (this.vault as any).signTransaction(
            signRequest.payload,
            signRequest.network
          )
          
          return { success: true, result: signature }
          
        default:
          // Forward to JSON-RPC server if available
          if (this.jsonRpcServer) {
            return await this.jsonRpcServer.handleRequest(request)
          }
          
          throw new Error(`Unknown method: ${request.method}`)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  private getDerivationPath(network: string): string {
    const paths: Record<string, string> = {
      'bitcoin': "m/84'/0'/0'/0/0",
      'ethereum': "m/44'/60'/0'/0/0", 
      'solana': "m/44'/501'/0'/0'",
      'litecoin': "m/84'/2'/0'/0/0",
      'dogecoin': "m/44'/3'/0'/0/0"
    }
    
    return paths[network.toLowerCase()] || "m/44'/0'/0'/0/0"
  }
  
  private async sendSocketCommand(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let buffer = ''
      
      socket.on('connect', () => {
        const request = { method, params }
        socket.write(JSON.stringify(request) + '\n')
      })
      
      socket.on('data', (data) => {
        buffer += data.toString()
        
        const lines = buffer.split('\n')
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim()) as DaemonResponse
              socket.end()
              
              if (response.success) {
                resolve(response.result)
              } else {
                reject(new Error(response.error || 'Unknown error'))
              }
              return
            } catch {
              // Continue reading
            }
          }
        }
      })
      
      socket.on('error', (error) => {
        reject(error)
      })
      
      socket.on('timeout', () => {
        reject(new Error('Socket timeout'))
      })
      
      socket.setTimeout(5000)
    })
  }
  
  private async writePIDFile(): Promise<void> {
    await fs.promises.writeFile(this.pidFile, process.pid.toString())
  }
  
  private async isPIDFileValid(): Promise<boolean> {
    try {
      const pid = parseInt(await fs.promises.readFile(this.pidFile, 'utf8'))
      // Check if process is running
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  
  private async waitForShutdown(): Promise<void> {
    // Wait for PID file to be removed or process to exit
    for (let i = 0; i < 50; i++) { // Wait up to 5 seconds
      if (!(await this.isPIDFileValid())) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Daemon did not shutdown gracefully')
  }
  
  private async shutdownByPID(): Promise<void> {
    try {
      const pid = parseInt(await fs.promises.readFile(this.pidFile, 'utf8'))
      process.kill(pid, 'SIGTERM')
      
      // Wait for process to exit
      await this.waitForShutdown()
      
      // Clean up PID file
      try {
        await fs.promises.unlink(this.pidFile)
      } catch {
        // Already removed
      }
      
      console.log('✅ Daemon shutdown via PID')
    } catch (error) {
      throw new Error(`Failed to shutdown daemon: ${error instanceof Error ? error.message : error}`)
    }
  }
  
  private handleShutdown(signal: string): void {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
    
    // Clean up socket
    try {
      fs.unlinkSync(this.socketPath)
    } catch {
      // Already removed
    }
    
    // Clean up PID file
    try {
      fs.unlinkSync(this.pidFile)
    } catch {
      // Already removed
    }
    
    console.log('✅ Cleanup completed')
    process.exit(0)
  }
}

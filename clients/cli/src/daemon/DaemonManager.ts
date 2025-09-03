import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { JsonRpcServer } from './JsonRpcServer'
import { VaultData } from '../vault/VaultLoader'

export interface DaemonRequest {
  method: string
  params?: Record<string, any>
}

export interface DaemonResponse {
  success: boolean
  result?: any
  error?: string
}

export class DaemonManager {
  private readonly socketPath: string
  private readonly jsonRpcSocketPath: string
  private readonly pidFile: string
  private jsonRpcServer?: JsonRpcServer
  
  constructor(
    socketPath: string = '/tmp/vultisig.sock',
    pidFile: string = '/tmp/vultisig.pid'
  ) {
    this.socketPath = socketPath
    this.jsonRpcSocketPath = '/tmp/vultisig-jsonrpc.sock'
    this.pidFile = pidFile
  }
  
  async startDaemon(vaultPath: string, password?: string, vault?: VaultData): Promise<void> {
    // Create PID file
    await this.writePIDFile()
    
    // Setup signal handling for graceful shutdown
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'))
    process.on('SIGINT', () => this.handleShutdown('SIGINT'))
    
    // Start Unix socket server for daemon commands
    const server = await this.startUnixSocket()
    
    console.log(`🔌 Started Unix socket server at ${this.socketPath}`)
    console.log(`📝 Created PID file at ${this.pidFile}`)
    
    // Create JSON-RPC server instance for package communication if vault is provided
    if (vault) {
      this.jsonRpcServer = new JsonRpcServer(vault)
      // Note: JSON-RPC server is used for request handling, not as a separate server
      console.log('📡 JSON-RPC handler integrated into main socket')
    }
    
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

  async getAddresses(networks: string[]): Promise<Record<string, string>> {
    try {
      // Check if daemon is running first
      await this.sendSocketCommand('ping', {})
    } catch (error) {
      throw new Error('No Vultisig daemon running, start with "vultisig run" first')
    }

    const addresses: Record<string, string> = {}
    
    // Query each network via JSON-RPC
    for (const network of networks) {
      try {
        const address = await this.getAddressForNetwork(network)
        addresses[network] = address
      } catch (error) {
        addresses[network] = `Error: ${error instanceof Error ? error.message : error}`
      }
    }
    
    return addresses
  }

  private async getAddressForNetwork(network: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let buffer = ''
      
      // Determine signature scheme based on network
      const eddsaNetworks = ['sol', 'sui', 'ton']
      const scheme = eddsaNetworks.includes(network.toLowerCase()) ? 'eddsa' : 'ecdsa'
      const curve = scheme === 'eddsa' ? 'ed25519' : 'secp256k1'
      
      const request = {
        id: Date.now(),
        method: 'get_address',
        params: {
          scheme,
          curve,
          network: network.toLowerCase()
        }
      }
      
      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\n')
      })
      
      socket.on('data', (data) => {
        buffer += data.toString()
        
        const lines = buffer.split('\n')
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line)
              socket.end()
              
              if (response.error) {
                reject(new Error(response.error.message))
              } else if (response.result?.address) {
                resolve(response.result.address)
              } else {
                reject(new Error('No address in response'))
              }
              return
            } catch (error) {
              // Continue reading
            }
          }
        }
      })
      
      socket.on('error', (error) => {
        reject(error)
      })
      
      socket.on('close', () => {
        reject(new Error('Connection closed without response'))
      })
      
      // Timeout after 10 seconds
      setTimeout(() => {
        socket.destroy()
        reject(new Error('Request timeout'))
      }, 10000)
    })
  }
  
  private async startUnixSocket(): Promise<net.Server> {
    // Remove existing socket if it exists
    try {
      await fs.promises.unlink(this.socketPath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    
    const server = net.createServer()
    
    return new Promise((resolve, reject) => {
      server.listen(this.socketPath, () => {
        // Set appropriate permissions (owner read/write only)
        fs.chmodSync(this.socketPath, 0o600)
        resolve(server)
      })
      
      server.on('error', reject)
    })
  }
  
  private handleConnection(socket: net.Socket): void {
    let buffer = ''
    
    socket.on('data', (data) => {
      buffer += data.toString()
      
      // Try to parse complete JSON messages (handle both \n and \r\n)  
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || '' // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          this.processRequest(socket, line.trim())
        }
      }
    })
    
    socket.on('error', (error) => {
      console.error('Socket error:', error)
    })
    
    socket.on('close', () => {
      // Connection closed
    })
  }
  
  private processRequest(socket: net.Socket, data: string): void {
    try {
      const parsed = JSON.parse(data)
      // Check if this is a JSON-RPC request (has 'id' field and 'params') or legacy daemon request
      if (typeof parsed.id !== 'undefined' && parsed.params && this.jsonRpcServer) {
        console.log('📡 Handling JSON-RPC request:', parsed.method)
        // Handle JSON-RPC request using the JSON-RPC server logic
        this.jsonRpcServer.handleRequestDirectly(data, socket)
        return
      }
      
      // Handle legacy daemon request
      const request: DaemonRequest = parsed
      let response: DaemonResponse
      
      switch (request.method) {
        case 'ping':
          response = { success: true, result: 'pong' }
          break
          
        case 'shutdown':
          response = { success: true, result: 'shutting down' }
          socket.write(JSON.stringify(response) + '\
')
          
          // Trigger shutdown after sending response
          setTimeout(() => {
            process.kill(process.pid, 'SIGTERM')
          }, 100)
          return
          
        default:
          response = {
            success: false,
            error: `Unknown method: ${request.method}`
          }
      }
      
      socket.write(JSON.stringify(response) + '\
')
      
    } catch (error) {
      const response: DaemonResponse = {
        success: false,
        error: `Invalid request format: ${error instanceof Error ? error.message : error}`
      }
      socket.write(JSON.stringify(response) + '\
')
    }
  }
  
  private async sendSocketCommand(method: string, params: Record<string, any>): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let buffer = ''
      
      const request: DaemonRequest = { method, params }
      
      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\
')
      })
      
      socket.on('data', (data) => {
        buffer += data.toString()
        
        const lines = buffer.split('\
')
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response: DaemonResponse = JSON.parse(line)
              socket.end()
              
              if (response.success) {
                resolve(response)
              } else {
                reject(new Error(response.error || 'Unknown daemon error'))
              }
              return
            } catch (error) {
              // Continue reading
            }
          }
        }
      })
      
      socket.on('error', (error) => {
        reject(error)
      })
      
      socket.on('close', () => {
        reject(new Error('Connection closed without response'))
      })
      
      // Timeout after 5 seconds
      setTimeout(() => {
        socket.destroy()
        reject(new Error('Request timeout'))
      }, 5000)
    })
  }
  
  private async writePIDFile(): Promise<void> {
    const pidDir = path.dirname(this.pidFile)
    await fs.promises.mkdir(pidDir, { recursive: true, mode: 0o755 })
    
    const pid = process.pid
    await fs.promises.writeFile(this.pidFile, pid.toString(), { mode: 0o644 })
  }
  
  private async isPIDFileValid(): Promise<boolean> {
    try {
      const pidData = await fs.promises.readFile(this.pidFile, 'utf8')
      const pid = parseInt(pidData.trim(), 10)
      
      if (isNaN(pid)) {
        return false
      }
      
      // Check if process exists (works on Unix systems)
      try {
        process.kill(pid, 0) // Signal 0 checks existence without killing
        return true
      } catch {
        return false
      }
    } catch {
      return false
    }
  }
  
  private async shutdownByPID(): Promise<void> {
    try {
      const pidData = await fs.promises.readFile(this.pidFile, 'utf8')
      const pid = parseInt(pidData.trim(), 10)
      
      if (isNaN(pid)) {
        throw new Error('Invalid PID in file')
      }
      
      console.log(`📧 Sending SIGTERM to daemon (PID ${pid})...`)
      process.kill(pid, 'SIGTERM')
      
      await this.waitForShutdown()
    } catch (error) {
      throw new Error(`Failed to shutdown by PID: ${error instanceof Error ? error.message : error}`)
    }
  }
  
  private async waitForShutdown(): Promise<void> {
    process.stdout.write('⏳ Waiting for daemon shutdown...')
    
    for (let i = 0; i < 30; i++) { // Wait up to 30 seconds
      if (!(await this.isPIDFileValid())) {
        console.log(' done!')
        return
      }
      process.stdout.write('.')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    console.log(' timeout!')
    throw new Error('Daemon did not shutdown within 30 seconds')
  }
  
  private async handleShutdown(signal: string): Promise<void> {
    console.log(`\
🔔 Received ${signal} signal, shutting down gracefully...`)
    
    // Cleanup
    await this.cleanup()
    console.log('✅ Daemon shutdown complete')
    
    process.exit(0)
  }
  
  private async cleanup(): Promise<void> {
    // Stop JSON-RPC server
    if (this.jsonRpcServer) {
      await this.jsonRpcServer.stop()
    }
    
    try {
      await fs.promises.unlink(this.pidFile)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to remove PID file:', error)
      }
    }
    
    try {
      await fs.promises.unlink(this.socketPath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to remove socket:', error)
      }
    }
    
    try {
      await fs.promises.unlink(this.jsonRpcSocketPath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to remove JSON-RPC socket:', error)
      }
    }
  }
}
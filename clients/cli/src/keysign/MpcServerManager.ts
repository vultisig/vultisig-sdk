import { exec } from 'child_process'
import { promisify } from 'util'
import * as net from 'net'

const execAsync = promisify(exec)

export type MpcServerType = 'relay' | 'local'

export interface MpcServerConfig {
  type: MpcServerType
  url: string
  serviceName?: string
  requiresMediator?: boolean
}

export class MpcServerManager {
  private static readonly SERVER_CONFIGS: Record<MpcServerType, MpcServerConfig> = {
    relay: {
      type: 'relay',
      url: 'https://api.vultisig.com/router',
      requiresMediator: false
    },
    local: {
      type: 'local', 
      url: 'http://127.0.0.1:18080',
      requiresMediator: true
    }
  }
  
  private mediatorProcess?: any
  
  /**
   * Get server configuration for the specified mode
   */
  getServerConfig(mode: MpcServerType): MpcServerConfig {
    return { ...MpcServerManager.SERVER_CONFIGS[mode] }
  }
  
  /**
   * Start the appropriate MPC server for the specified mode
   */
  async startServer(mode: MpcServerType, serviceName?: string): Promise<MpcServerConfig> {
    const config = this.getServerConfig(mode)
    
    if (mode === 'local') {
      // For local mode, we need to start the mediator service
      await this.startLocalMediator(serviceName)
      config.serviceName = serviceName
    }
    
    return config
  }
  
  /**
   * Stop the MPC server services
   */
  async stopServer(): Promise<void> {
    if (this.mediatorProcess) {
      console.log('🛑 Stopping local MPC mediator...')
      
      try {
        // Try graceful shutdown first
        this.mediatorProcess.kill('SIGTERM')
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.mediatorProcess && !this.mediatorProcess.killed) {
            this.mediatorProcess.kill('SIGKILL')
          }
        }, 5000)
        
        this.mediatorProcess = undefined
        console.log('✅ Local MPC mediator stopped')
        
      } catch (error) {
        console.warn('⚠️  Error stopping mediator:', error)
      }
    }
  }
  
  /**
   * Start the local mDNS mediator service for peer-to-peer coordination
   */
  private async startLocalMediator(serviceName?: string): Promise<void> {
    // Check if mediator service is already running
    if (await this.isLocalMediatorRunning()) {
      console.log('✅ Local MPC mediator already running')
      return
    }
    
    console.log('🚀 Starting local MPC mediator...')
    
    try {
      // In a real implementation, this would start the actual mediator service
      // from the TSS library or a separate mediator binary
      // For now, we'll simulate starting a local service
      
      const service = serviceName || `vultisig-cli-${Date.now()}`
      
      // Start a simple HTTP server to simulate the mediator
      await this.startMockMediator(service)
      
      console.log(`✅ Local MPC mediator started for service: ${service}`)
      
    } catch (error) {
      console.error('❌ Failed to start local MPC mediator:', error)
      throw new Error(`Failed to start local mediator: ${error}`)
    }
  }
  
  /**
   * Check if the local mediator is running
   */
  private async isLocalMediatorRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      
      socket.setTimeout(1000)
      
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      
      socket.on('error', () => {
        resolve(false)
      })
      
      socket.connect(18080, '127.0.0.1')
    })
  }
  
  /**
   * Start a mock mediator service for testing
   */
  private async startMockMediator(serviceName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const express = require('express')
      const app = express()
      
      app.use(express.json())
      
      // Mock mediator endpoints
      app.post('/start', (req: any, res: any) => {
        console.log(`📡 Mock mediator: Session started for ${serviceName}`)
        res.json({ status: 'started', service: serviceName })
      })
      
      app.post('/join/:sessionId', (req: any, res: any) => {
        console.log(`📡 Mock mediator: Device joined session ${req.params.sessionId}`)
        res.json({ status: 'joined', sessionId: req.params.sessionId })
      })
      
      app.get('/status/:sessionId', (req: any, res: any) => {
        res.json({ 
          status: 'waiting', 
          sessionId: req.params.sessionId,
          peers: []
        })
      })
      
      const server = app.listen(18080, '127.0.0.1', () => {
        console.log('🌐 Mock mediator listening on http://127.0.0.1:18080')
        resolve()
      })
      
      server.on('error', (error: Error) => {
        reject(error)
      })
      
      // Store reference for cleanup
      this.mediatorProcess = {
        kill: (signal: string) => {
          server.close()
          return true
        },
        killed: false
      }
    })
  }
  
  /**
   * Get the appropriate server URL for the mode
   */
  getServerUrl(mode: MpcServerType): string {
    return MpcServerManager.SERVER_CONFIGS[mode].url
  }
  
  /**
   * Check if the server is reachable
   */
  async isServerReachable(mode: MpcServerType): Promise<boolean> {
    const config = this.getServerConfig(mode)
    
    try {
      if (mode === 'local') {
        return await this.isLocalMediatorRunning()
      } else {
        // For relay mode, we could ping the API endpoint
        // For now, assume it's always reachable
        return true
      }
    } catch (error) {
      console.warn(`Failed to check server reachability for ${mode}:`, error)
      return false
    }
  }
  
  /**
   * Get display information for the server mode
   */
  getServerDisplayInfo(mode: MpcServerType): { title: string; description: string; icon: string } {
    switch (mode) {
      case 'relay':
        return {
          title: 'Relay Mode',
          description: 'Uses Vultisig relay server for global coordination',
          icon: '🌐'
        }
        
      case 'local':
        return {
          title: 'Local Mode', 
          description: 'Uses local mDNS for peer-to-peer coordination',
          icon: '📡'
        }
        
      default:
        return {
          title: 'Unknown Mode',
          description: 'Unknown server configuration',
          icon: '❓'
        }
    }
  }
}
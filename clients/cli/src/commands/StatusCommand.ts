import { DaemonManager } from '../daemon/DaemonManager'

export class StatusCommand {
  readonly description = 'Check daemon status'
  
  async run(): Promise<void> {
    console.log('🔍 Checking daemon status...')
    
    const daemonManager = new DaemonManager()
    await daemonManager.checkDaemonStatus()
  }
}
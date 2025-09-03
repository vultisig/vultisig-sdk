import fetch from 'node-fetch'

export interface RelaySessionParticipant {
  id: string
  timestamp?: number
}

export class RelayClient {
  private baseUrl: string
  
  constructor(baseUrl: string = 'https://api.vultisig.com/router') {
    this.baseUrl = baseUrl
  }
  
  /**
   * Start a session with expected participants
   */
  async startSession(sessionId: string, expectedParticipants: string[]): Promise<void> {
    const url = `${this.baseUrl}/start/${sessionId}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(expectedParticipants)
      })
      
      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.status} ${response.statusText}`)
      }
      
      console.log(`📡 Started relay session: ${sessionId}`)
    } catch (error) {
      console.error('❌ Failed to start relay session:', error)
      throw error
    }
  }
  
  /**
   * Check if all expected participants have joined the session
   */
  async getSessionParticipants(sessionId: string): Promise<string[]> {
    const url = `${this.baseUrl}/start/${sessionId}`
    
    try {
      const response = await fetch(url, {
        method: 'GET'
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          return [] // Session not found or no participants yet
        }
        throw new Error(`Failed to get session participants: ${response.status} ${response.statusText}`)
      }
      
      const participants = await response.json() as string[]
      return Array.isArray(participants) ? participants : []
      
    } catch (error) {
      console.warn('⚠️ Error getting session participants:', error)
      return []
    }
  }
  
  /**
   * Wait for all expected participants to join the session
   */
  async waitForSessionStart(sessionId: string, expectedParticipants: string[], timeoutMs: number = 120000): Promise<string[]> {
    const startTime = Date.now()
    const pollInterval = 1000 // Poll every 1 second like Windows app
    
    console.log(`⏳ Waiting for participants to join session: ${sessionId}`)
    console.log(`   Expected: ${expectedParticipants.length} participants`)
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const participants = await this.getSessionParticipants(sessionId)
        
        console.log(`📡 Current participants: ${participants.length}/${expectedParticipants.length}`)
        
        // Check if we have enough participants for 2-of-2 MPC
        if (participants.length >= 2) {
          console.log(`✅ All participants joined: ${participants.join(', ')}`)
          return participants
        }
        
        // Wait before next poll
        await this.sleep(pollInterval)
        
      } catch (error) {
        console.warn('⚠️ Error polling session:', error)
        await this.sleep(pollInterval)
      }
    }
    
    throw new Error(`Timeout waiting for participants to join session ${sessionId}`)
  }
  
  /**
   * Register this device as a participant in the session
   */
  async joinSession(sessionId: string, participantId: string): Promise<void> {
    const url = `${this.baseUrl}/${sessionId}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([participantId])
      })
      
      if (!response.ok) {
        throw new Error(`Failed to join session: ${response.status} ${response.statusText}`)
      }
      
      console.log(`📡 Joined relay session as: ${participantId}`)
      
    } catch (error) {
      console.error('❌ Failed to join relay session:', error)
      throw error
    }
  }
  
  /**
   * Get current session status and participants
   */
  async getSessionStatus(sessionId: string): Promise<{participants: string[], ready: boolean}> {
    try {
      const participants = await this.getSessionParticipants(sessionId)
      const ready = participants.length >= 2
      
      return { participants, ready }
      
    } catch (error) {
      console.warn('⚠️ Error getting session status:', error)
      return { participants: [], ready: false }
    }
  }
  
  /**
   * Mark session as complete
   */
  async completeSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/complete/${sessionId}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ completed: true })
      })
      
      if (!response.ok) {
        console.warn(`Failed to mark session complete: ${response.status}`)
      } else {
        console.log(`✅ Session marked as complete: ${sessionId}`)
      }
      
    } catch (error) {
      console.warn('⚠️ Error completing session:', error)
    }
  }
  
  /**
   * Submit keysign result to relay server
   */
  async submitKeysignResult(sessionId: string, result: {signature: string, txHash?: string}): Promise<void> {
    const url = `${this.baseUrl}/complete/${sessionId}/keysign`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(result)
      })
      
      if (!response.ok) {
        console.warn(`Failed to submit keysign result: ${response.status}`)
      } else {
        console.log(`✅ Keysign result submitted for session: ${sessionId}`)
      }
      
    } catch (error) {
      console.warn('⚠️ Error submitting keysign result:', error)
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
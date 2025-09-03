// Vultisig Keysign Interface JavaScript
// Based on Windows App UI patterns

class KeysignInterface {
  constructor() {
    this.statusCheckInterval = null
    this.isSigningComplete = false
    
    this.init()
  }
  
  init() {
    console.log('🚀 Keysign interface initialized')
    this.startStatusPolling()
    this.setupEventListeners()
  }
  
  setupEventListeners() {
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopStatusPolling()
      } else {
        this.startStatusPolling()
      }
    })
    
    // Handle beforeunload for cleanup
    window.addEventListener('beforeunload', () => {
      this.cleanup()
    })
    
    // Copy address functionality
    document.querySelectorAll('.address').forEach(element => {
      element.style.cursor = 'pointer'
      element.title = 'Click to copy address'
      
      element.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(element.textContent)
          this.showToast('Address copied to clipboard!')
        } catch (err) {
          console.error('Failed to copy address:', err)
          this.showToast('Failed to copy address', 'error')
        }
      })
    })
  }
  
  async startStatusPolling() {
    if (this.statusCheckInterval || this.isSigningComplete) {
      return
    }
    
    console.log('📡 Starting status polling...')
    
    // Initial status check
    await this.checkStatus()
    
    // Poll every 2 seconds
    this.statusCheckInterval = setInterval(async () => {
      await this.checkStatus()
    }, 2000)
  }
  
  stopStatusPolling() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval)
      this.statusCheckInterval = null
      console.log('📡 Status polling stopped')
    }
  }
  
  async checkStatus() {
    try {
      const response = await fetch('/api/status')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      const status = await response.json()
      this.updateStatusUI(status)
      
      // Stop polling if signing is complete
      if (status.signingComplete) {
        this.isSigningComplete = true
        this.stopStatusPolling()
      }
      
    } catch (error) {
      console.error('Failed to check status:', error)
      this.updateStatusUI({
        status: 'error',
        message: 'Failed to connect to signing service'
      })
    }
  }
  
  updateStatusUI(status) {
    const statusIndicator = document.querySelector('.status-indicator')
    const statusIcon = document.querySelector('.status-icon')
    const statusTitle = document.querySelector('.status-text h4')
    const statusMessage = document.querySelector('.status-text p')
    
    if (!statusIndicator || !statusIcon || !statusTitle || !statusMessage) {
      return
    }
    
    // Remove existing status classes
    statusIndicator.classList.remove('waiting', 'signing', 'success', 'error')
    
    switch (status.status) {
      case 'waiting_for_mobile':
        statusIndicator.classList.add('waiting')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'Waiting for Mobile App'
        statusMessage.textContent = status.message || 'Please scan the QR code with your mobile device'
        break
        
      case 'peer_discovered':
        statusIndicator.classList.add('waiting')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'Mobile App Connected'
        statusMessage.textContent = 'Waiting for transaction approval...'
        this.showToast('Mobile app connected!', 'success')
        break
        
      case 'joining':
        statusIndicator.classList.add('signing')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'Starting Session'
        statusMessage.textContent = 'All parties joining the signing session...'
        break
        
      case 'signing':
      case 'round1':
        statusIndicator.classList.add('signing')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'MPC Signing - Round 1'
        statusMessage.textContent = 'Multi-party signature generation in progress...'
        break
        
      case 'round2':
        statusIndicator.classList.add('signing')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'MPC Signing - Round 2'
        statusMessage.textContent = 'Continuing signature computation...'
        break
        
      case 'round3':
        statusIndicator.classList.add('signing')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'MPC Signing - Round 3'
        statusMessage.textContent = 'Finalizing signature...'
        break
        
      case 'complete':
        statusIndicator.classList.add('signing')
        statusIcon.innerHTML = '<div class="spinner"></div>'
        statusTitle.textContent = 'Broadcasting Transaction'
        statusMessage.textContent = 'Signature complete, broadcasting to network...'
        break
        
      case 'success':
        statusIndicator.classList.add('success')
        statusIcon.innerHTML = '<div class="success-animation"></div>'
        statusTitle.textContent = 'Transaction Signed Successfully!'
        statusMessage.textContent = status.txHash ? `Transaction Hash: ${status.txHash}` : 'Transaction has been signed and broadcasted'
        this.showToast('Transaction signed successfully!', 'success')
        this.handleSigningSuccess(status)
        break
        
      case 'error':
        statusIndicator.classList.add('error')
        statusIcon.innerHTML = '<div class="error-animation"></div>'
        statusTitle.textContent = 'Signing Failed'
        statusMessage.textContent = status.message || 'An error occurred during signing'
        this.showToast('Signing failed: ' + (status.message || 'Unknown error'), 'error')
        break
        
      default:
        console.warn('Unknown status:', status.status)
    }
    
    // Update peer count if available
    if (status.peers && status.peers.length > 0) {
      this.updatePeerCount(status.peers.length)
    }
  }
  
  updatePeerCount(count) {
    const peerInfo = document.querySelector('.peer-info')
    if (!peerInfo) {
      // Create peer info element if it doesn't exist
      const statusSection = document.querySelector('.status-section')
      const peerDiv = document.createElement('div')
      peerDiv.className = 'peer-info'
      peerDiv.innerHTML = `<small>Connected devices: ${count}</small>`
      statusSection.appendChild(peerDiv)
    } else {
      peerInfo.innerHTML = `<small>Connected devices: ${count}</small>`
    }
  }
  
  handleSigningSuccess(status) {
    // Show success state for 5 seconds, then provide options
    setTimeout(() => {
      const statusMessage = document.querySelector('.status-text p')
      if (statusMessage) {
        statusMessage.innerHTML = `
          Transaction completed successfully!<br>
          <small style="margin-top: 0.5rem; display: inline-block;">
            You can close this window or press Ctrl+C in the terminal.
          </small>
        `
      }
    }, 5000)
  }
  
  showToast(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(toast => toast.remove())
    
    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.textContent = message
    
    // Style the toast
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '1rem 1.5rem',
      borderRadius: '8px',
      color: 'white',
      fontWeight: '500',
      zIndex: '1000',
      opacity: '0',
      transform: 'translateY(-20px)',
      transition: 'all 0.3s ease',
      maxWidth: '400px',
      wordWrap: 'break-word'
    })
    
    // Set background color based on type
    switch (type) {
      case 'success':
        toast.style.background = '#10B981'
        break
      case 'error':
        toast.style.background = '#EF4444'
        break
      case 'warning':
        toast.style.background = '#F59E0B'
        break
      default:
        toast.style.background = '#3B82F6'
    }
    
    document.body.appendChild(toast)
    
    // Animate in
    setTimeout(() => {
      toast.style.opacity = '1'
      toast.style.transform = 'translateY(0)'
    }, 100)
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(-20px)'
      setTimeout(() => toast.remove(), 300)
    }, 4000)
  }
  
  cleanup() {
    this.stopStatusPolling()
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.keysignInterface = new KeysignInterface()
})

// Utility functions
function formatAddress(address, length = 8) {
  if (!address || address.length <= length * 2) {
    return address
  }
  return `${address.slice(0, length)}...${address.slice(-length)}`
}

function formatAmount(amount, decimals = 6) {
  const num = parseFloat(amount)
  if (isNaN(num)) return amount
  
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K'
  } else if (num < 0.000001) {
    return num.toExponential(2)
  } else {
    return num.toFixed(decimals)
  }
}
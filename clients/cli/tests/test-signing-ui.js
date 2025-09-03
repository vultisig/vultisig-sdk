#!/usr/bin/env node

// Simple test to demonstrate the keysign UI functionality
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

console.log('🚀 Starting Vultisig Keysign UI Test...\n');

// Mock transaction data
const mockTransactionData = {
  sessionId: `test-session-${Date.now()}`,
  vault: {
    name: 'Test Vault',
    publicKeyEcdsa: '0x1234567890abcdef...',
    signers: ['device1', 'device2']
  },
  transaction: {
    coin: {
      chain: 'Ethereum',
      ticker: 'ETH'
    },
    toAddress: '0x742e4C4B4F6F8e8eBd53aB6C5c5A6e1F8E5D4C3B',
    toAmount: '0.1',
    memo: 'Test transaction'
  },
  mode: 'relay'
};

// Generate mock keysign URI
const mockKeysignUri = `vultisig://vultisig.com?type=SignTransaction&vault=test-vault&jsonData=${Buffer.from(JSON.stringify(mockTransactionData)).toString('base64')}`;

console.log('📝 Mock Transaction Details:');
console.log(`  Vault: ${mockTransactionData.vault.name}`);
console.log(`  Network: ${mockTransactionData.transaction.coin.chain}`);
console.log(`  To: ${mockTransactionData.transaction.toAddress}`);
console.log(`  Amount: ${mockTransactionData.transaction.toAmount} ${mockTransactionData.transaction.coin.ticker}`);
console.log(`  Session: ${mockTransactionData.sessionId}`);
console.log(`  Mode: ${mockTransactionData.mode.toUpperCase()}`);

// Create Express app
const app = express();

// Serve static assets
app.use('/static', express.static(path.join(__dirname, 'web/static')));

// Main keysign page
app.get('/', async (req, res) => {
  try {
    // Generate QR code data URL
    const qrDataUrl = await QRCode.toDataURL(mockKeysignUri, {
      width: 300,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vultisig Keysign - ${mockTransactionData.vault.name}</title>
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
          <div class="mode-badge ${mockTransactionData.mode}">
            ${mockTransactionData.mode === 'relay' ? 'Relay Mode' : 'Local Mode'}
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
                <span class="value">${mockTransactionData.vault.name}</span>
              </div>
              <div class="tx-row">
                <span class="label">Session:</span>
                <span class="value">${mockTransactionData.sessionId}</span>
              </div>
              <div class="tx-row">
                <span class="label">Network:</span>
                <span class="value">${mockTransactionData.transaction.coin.chain}</span>
              </div>
              <div class="tx-row">
                <span class="label">To Address:</span>
                <span class="value address">${mockTransactionData.transaction.toAddress}</span>
              </div>
              <div class="tx-row">
                <span class="label">Amount:</span>
                <span class="value">${mockTransactionData.transaction.toAmount} ${mockTransactionData.transaction.coin.ticker}</span>
              </div>
              <div class="tx-row">
                <span class="label">Memo:</span>
                <span class="value">${mockTransactionData.transaction.memo}</span>
              </div>
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
      <script>
        // Override status polling for demo
        if (window.keysignInterface) {
          setTimeout(() => {
            window.keysignInterface.updateStatusUI({
              status: 'peer_discovered',
              message: 'Mobile app connected (demo mode)'
            });
          }, 3000);
          
          setTimeout(() => {
            window.keysignInterface.updateStatusUI({
              status: 'signing',
              message: 'Demo signing in progress...'
            });
          }, 6000);
          
          setTimeout(() => {
            window.keysignInterface.updateStatusUI({
              status: 'success',
              message: 'Demo transaction signed successfully!',
              txHash: '0xabcd1234567890ef...'
            });
          }, 9000);
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Error generating page:', error);
    res.status(500).send('Internal Server Error');
  }
});

// QR code API
app.get('/api/qr', async (req, res) => {
  try {
    const format = req.query.format || 'png';
    
    if (format === 'dataurl') {
      const dataUrl = await QRCode.toDataURL(mockKeysignUri);
      res.json({ dataUrl });
    } else {
      const qrCode = await QRCode.toBuffer(mockKeysignUri);
      res.setHeader('Content-Type', 'image/png');
      res.send(qrCode);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Transaction API
app.get('/api/transaction', (req, res) => {
  res.json(mockTransactionData);
});

// Status API (mock status updates)
app.get('/api/status', (req, res) => {
  res.json({
    status: 'waiting_for_mobile',
    message: 'Waiting for mobile app to scan QR code... (demo mode)',
    peers: [],
    signingComplete: false
  });
});

// Start server
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  
  console.log(`\\n🌐 Keysign web interface started: ${url}`);
  console.log(`\\n📱 Features demonstrated:`);
  console.log(`  • QR code generation with keysign URI`);
  console.log(`  • Transaction details display`);
  console.log(`  • Real-time status updates`);
  console.log(`  • Responsive Vultisig UI design`);
  console.log(`  • Mock signing flow simulation`);
  
  console.log(`\\n🔍 QR Code URI (first 100 chars):`);
  console.log(`  ${mockKeysignUri.substring(0, 100)}...`);
  
  console.log(`\\n✨ Opening browser in 2 seconds...`);
  
  // Auto-open browser
  setTimeout(() => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : 
                platform === 'win32' ? 'start' : 'xdg-open';
    
    exec(`${cmd} ${url}`, (error) => {
      if (error) {
        console.log(`\\n⚠️  Could not auto-open browser. Please manually visit: ${url}`);
      } else {
        console.log(`\\n✅ Opened web interface in your default browser`);
        console.log(`\\n⌨️  Press Ctrl+C to stop the server`);
      }
    });
  }, 2000);
});

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\\n\\n🛑 Shutting down keysign UI test server...');
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
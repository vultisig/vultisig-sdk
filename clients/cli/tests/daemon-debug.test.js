const { spawn } = require('child_process');
const { testJsonRpcRequest } = require('./json-rpc-client.js');
const fs = require('fs');
const path = require('path');

async function debugDaemonTest() {
  const CLI_PATH = path.join(__dirname, '..', 'dist', 'clients', 'cli-ts', 'src', 'cli.js');
  const KEYSHARE_PATH = path.join(__dirname, '..', 'keyshares', 'TestSecureVault-cfa0-share2of2.vult');
  const SOCKET_PATH = '/tmp/vultisig.sock';
  
  console.log('🐛 Daemon Debug Test');
  console.log('===================\n');
  
  // Clean up existing socket
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  
  // Start daemon
  console.log('Starting daemon...');
  const daemon = spawn('node', [CLI_PATH, 'run', '--vault', KEYSHARE_PATH], {
    stdio: ['ignore', 'inherit', 'inherit']
  });
  
  // Wait for socket
  await new Promise(resolve => {
    const check = () => {
      if (fs.existsSync(SOCKET_PATH)) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
  
  console.log('Socket exists, waiting for full startup...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    // Test JSON-RPC request
    console.log('Testing JSON-RPC request...');
    const result = await testJsonRpcRequest({
      id: 1,
      method: 'get_address',  
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'eth'
      }
    });
    
    console.log('✅ Got result:', result);
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
  
  // Stop daemon
  daemon.kill('SIGTERM');
  
  // Cleanup
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
}

// Run if called directly
if (require.main === module) {
  debugDaemonTest().catch(console.error);
}

module.exports = { debugDaemonTest };
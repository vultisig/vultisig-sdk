const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Test Suite: Package Workflow
 * Tests complete workflow: daemon startup -> package usage -> cleanup
 */

console.log('🧪 Package Workflow Test Suite');
console.log('===============================\n');

async function testPackageWorkflow() {
  const CLI_PATH = path.join(__dirname, '..', 'dist', 'clients', 'cli-ts', 'src', 'cli.js');
  const KEYSHARE_PATH = path.join(__dirname, '..', 'keyshares', 'TestSecureVault-cfa0-share2of2.vult');
  const SOCKET_PATH = '/tmp/vultisig.sock';
  
  let daemon = null;
  let testResults = {
    total: 0,
    passed: 0
  };
  
  function test(name, success, details = '') {
    testResults.total++;
    if (success) {
      console.log(`✅ ${name}`);
      testResults.passed++;
    } else {
      console.log(`❌ ${name}`);
      if (details) console.log(`   ${details}`);
    }
  }
  
  try {
    // Clean up any existing socket
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    
    console.log('🚀 Starting daemon...');
    daemon = spawn('node', [CLI_PATH, 'run', '--vault', KEYSHARE_PATH], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Capture daemon output for debugging
    let daemonOutput = '';
    daemon.stdout.on('data', (data) => {
      daemonOutput += data.toString();
    });
    daemon.stderr.on('data', (data) => {
      daemonOutput += data.toString();
    });
    
    // Wait for socket to be created
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Daemon startup timeout')), 15000);
      const check = () => {
        if (fs.existsSync(SOCKET_PATH)) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
    
    test('Daemon started and socket created', fs.existsSync(SOCKET_PATH));
    
    // Wait for full initialization  
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('\n📦 Testing package imports and basic functionality...');
    
    // Test that packages can be imported (they're built)
    try {
      const VultisigEthSigner = require('../packages/vultisig-eth-signer/dist/VultisigSigner.js').VultisigSigner;
      test('Ethereum signer package can be imported', !!VultisigEthSigner);
      
      const VultisigBtcSigner = require('../packages/vultisig-btc-signer/dist/VultisigSigner.js').VultisigSigner;
      test('Bitcoin signer package can be imported', !!VultisigBtcSigner);
      
      const VultisigSolSigner = require('../packages/vultisig-sol-signer/dist/VultisigSigner.js').VultisigSigner;
      test('Solana signer package can be imported', !!VultisigSolSigner);
      
    } catch (error) {
      test('Package imports', false, error.message);
    }
    
    console.log('\\n📡 Testing direct socket communication...');
    
    // Test direct socket communication with manual client
    try {
      const net = require('net');
      
      const testRequest = (request) => {
        return new Promise((resolve, reject) => {
          const socket = net.createConnection(SOCKET_PATH);
          let response = '';
          
          socket.setTimeout(5000);
          
          socket.on('connect', () => {
            socket.write(JSON.stringify(request) + '\\n');
          });
          
          socket.on('data', (data) => {
            response += data.toString();
            if (response.includes('}\\n')) {
              socket.end();
              try {
                resolve(JSON.parse(response.trim()));
              } catch (e) {
                reject(new Error(`Parse error: ${e.message}, got: ${response}`));
              }
            }
          });
          
          socket.on('error', reject);
          socket.on('timeout', () => reject(new Error('Socket timeout')));
        });
      };
      
      // Test legacy daemon ping
      const pingResult = await testRequest({ method: 'ping' });
      test('Legacy daemon ping works', pingResult.success === true && pingResult.result === 'pong');
      
      // Test JSON-RPC address request  
      try {
        const addressResult = await testRequest({
          id: 1,
          method: 'get_address',
          params: {
            scheme: 'ecdsa',
            curve: 'secp256k1', 
            network: 'eth'
          }
        });
        
        test('JSON-RPC address request handled', !addressResult.error);
        if (addressResult.result && addressResult.result.address) {
          test('Ethereum address returned', addressResult.result.address.startsWith('0x'));
          console.log(`   📍 Address: ${addressResult.result.address}`);
        }
      } catch (error) {
        test('JSON-RPC address request', false, error.message);
      }
      
    } catch (error) {
      test('Direct socket communication', false, error.message);
    }
    
    console.log('\\n📊 Test Summary');
    console.log('================');
    console.log(`Total tests: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed}`);
    console.log(`Failed: ${testResults.total - testResults.passed}`);
    console.log(`Success rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
    
    if (testResults.passed === testResults.total) {
      console.log('\\n🎉 All package workflow tests passed!');
      console.log('✅ Daemon startup working');
      console.log('✅ Packages can be imported');
      console.log('✅ Socket communication working');
      console.log('✅ JSON-RPC integration working');
    } else {
      console.log('\\n⚠️  Some package workflow tests failed.');
      console.log('🔧 Check daemon logs and socket communication.');
    }
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    test('Test suite execution', false, error.message);
  } finally {
    // Cleanup
    console.log('\\n🧹 Cleaning up...');
    
    if (daemon) {
      try {
        daemon.kill('SIGTERM');
        // Give it time to shut down gracefully
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log('⚠️  Error stopping daemon:', error.message);
      }
    }
    
    // Clean up socket
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
      console.log('✅ Socket cleaned up');
    }
    
    // Clean up PID file
    const pidFile = '/tmp/vultisig.pid';
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      console.log('✅ PID file cleaned up');
    }
  }
}

// Export for use in other test files
module.exports = { testPackageWorkflow };

// Run tests if called directly
if (require.main === module) {
  testPackageWorkflow().catch(console.error);
}
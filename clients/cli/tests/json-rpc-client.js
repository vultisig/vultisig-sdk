const net = require('net');

/**
 * Simple JSON-RPC client for testing daemon communication
 */

async function testJsonRpcRequest(request, socketPath = '/tmp/vultisig.sock') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let responseData = '';
    
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, 10000);
    
    socket.on('connect', () => {
      const requestJson = JSON.stringify(request) + '\n';
      console.log(`📡 Sending: ${requestJson.trim()}`);
      socket.write(requestJson);
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      // Check if we have a complete response (ends with newline)
      if (responseData.endsWith('\n')) {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(responseData.trim());
          console.log(`📡 Received: ${JSON.stringify(response)}`);
          socket.end();
          resolve(response);
        } catch (error) {
          socket.end();
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Socket error: ${error.message}`));
    });
    
    socket.on('close', () => {
      clearTimeout(timeout);
      if (!responseData) {
        reject(new Error('Connection closed without response'));
      }
    });
  });
}

module.exports = { testJsonRpcRequest };
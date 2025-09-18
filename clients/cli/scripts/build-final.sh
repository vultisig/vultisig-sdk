#!/bin/bash

# Vultisig CLI Build Script - Final Working Version
set -e

echo "🏗️  Building Vultisig CLI (Final Version)..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SDK_DIR="$PROJECT_DIR/../../src"

echo -e "${BLUE}📁 Project directory: ${PROJECT_DIR}${NC}"
echo -e "${BLUE}📁 SDK directory: ${SDK_DIR}${NC}"

# Step 1: Build SDK for Node.js
echo -e "${YELLOW}🔧 Building SDK for Node.js...${NC}"
cd "$SDK_DIR"

# Build the Node.js CJS version
node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js

if [ ! -f "$SDK_DIR/dist/index.node.cjs" ]; then
    echo -e "${RED}❌ SDK Node.js build failed${NC}"
    exit 1
fi

# Copy missing WASM files
echo -e "${YELLOW}📦 Copying WASM files...${NC}"
if [ -f "../clients/extension/dist/assets/secp256k1.wasm" ]; then
    cp "../clients/extension/dist/assets/secp256k1.wasm" "dist/"
    cp "../clients/extension/dist/assets/secp256k1.wasm" "dist/wasm/"
fi

echo -e "${GREEN}✅ SDK built successfully ($(du -h dist/index.node.cjs | cut -f1))${NC}"

# Step 2: Build CLI TypeScript
echo -e "${YELLOW}🔨 Compiling CLI TypeScript...${NC}"
cd "$PROJECT_DIR"

# Clean previous builds
rm -rf dist bin
mkdir -p bin

yarn build

if [ ! -f "$PROJECT_DIR/dist/cli.js" ]; then
    echo -e "${RED}❌ CLI TypeScript compilation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ CLI TypeScript compilation successful${NC}"

# Step 3: Create the final CLI launcher
echo -e "${YELLOW}📦 Creating CLI launcher...${NC}"

cat > "$PROJECT_DIR/bin/vultisig" << 'EOF'
#!/usr/bin/env node

/**
 * Vultisig CLI Launcher - Working Version
 * Loads WalletCore and SDK with proper WASM support
 */

const path = require('path');
const fs = require('fs');

// File polyfill for Node.js - working version
globalThis.File = function File(chunks, name, options) {
  this.chunks = chunks;
  this.name = name;
  this.options = options;
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  this.buffer = buffer;
  this._buffer = buffer;
  this.arrayBuffer = function() {
    return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  };
};

// Setup fetch polyfill for WASM file loading (from vitest.setup.ts)
const originalFetch = globalThis.fetch;

globalThis.fetch = async function(url) {
  const urlString = url.toString();
  
  if (urlString.includes('.wasm')) {
    const fs = require('fs');
    // Get the correct project root (vultisig-sdk directory)
    const projectRoot = path.resolve(__dirname, '../../..');
    
    // Try to load from filesystem
    let wasmPath;
    
    if (urlString.includes('wallet-core.wasm')) {
      wasmPath = path.join(projectRoot, 'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm');
    } else if (urlString.includes('vs_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/dkls/vs_wasm_bg.wasm');
    } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/schnorr/vs_schnorr_wasm_bg.wasm');
    } else {
      // Extract filename and try common locations
      const filename = urlString.split('/').pop() || '';
      const possiblePaths = [
        path.join(projectRoot, 'node_modules/@trustwallet/wallet-core/dist/lib/', filename),
        path.join(projectRoot, 'lib/dkls/', filename),
        path.join(projectRoot, 'lib/schnorr/', filename),
        path.join(projectRoot, 'src/dist/wasm/', filename),
        path.join(projectRoot, 'src/dist/', filename)
      ];
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          wasmPath = testPath;
          break;
        }
      }
      
      if (!wasmPath) {
        throw new Error(`WASM file not found: ${urlString}`);
      }
    }
    
    try {
      const wasmBuffer = fs.readFileSync(wasmPath);
      const arrayBuffer = wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength);
      
      return new Response(arrayBuffer, {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/wasm'
        })
      });
    } catch (error) {
      throw new Error(`Failed to load WASM file ${wasmPath}: ${error.message}`);
    }
  }
  
  // For non-WASM requests, use original fetch if available
  if (originalFetch) {
    return originalFetch(url);
  }
  
  // Fallback for non-WASM requests when no original fetch
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found')
  });
};

// Check WebAssembly support
if (typeof globalThis.WebAssembly === 'undefined') {
  console.error('❌ WebAssembly not supported in this Node.js version');
  console.error('💡 Please use Node.js 18+ with WebAssembly support');
  process.exit(1);
}

(async function main() {
  try {
    // Get the directory paths
    const cliDir = __dirname;
    const projectRoot = path.resolve(cliDir, '..');
    const sdkPath = path.resolve(projectRoot, '../../src');
    
    // Require the CommonJS SDK build
    const { Vultisig } = require(path.resolve(sdkPath, 'dist/index.node.cjs'));
    
    // Make SDK available globally for the CLI
    globalThis.Vultisig = Vultisig;
    
    // Now require the CLI
    require(path.resolve(projectRoot, 'dist/cli.js'));
    
  } catch (error) {
    console.error('❌ Failed to start Vultisig CLI:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Make sure you have built the SDK: cd ../../src && yarn build');
    console.error('   2. Make sure Node.js version is 18+: node --version');
    console.error('   3. Check that WASM files exist in SDK dist directory');
    process.exit(1);
  }
})();
EOF

chmod +x "$PROJECT_DIR/bin/vultisig"

echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo -e "${GREEN}📍 CLI created at: ${PROJECT_DIR}/bin/vultisig${NC}"
echo ""
echo -e "${BLUE}📋 Verification:${NC}"
"$PROJECT_DIR/bin/vultisig" --version
echo ""
echo -e "${BLUE}📋 Installation:${NC}"
echo -e "   sudo cp ${PROJECT_DIR}/bin/vultisig /usr/local/bin/"
echo ""
echo -e "${BLUE}📋 Usage:${NC}"
echo -e "   vultisig init      # Initialize directories"
echo -e "   vultisig list      # List vault files"
echo -e "   vultisig run       # Start daemon"
echo ""
echo -e "${GREEN}✅ CLI is ready to use!${NC}"
